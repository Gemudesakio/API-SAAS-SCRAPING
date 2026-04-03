import { chromium } from 'playwright';
import { AppError } from '../../errors/app-error.js';
import { attrOrEmpty, buildUserAgent, detectChallenge, textOrEmpty } from '../../utils/scraper.helpers.js';
import { collectPageDiagnostics } from '../../utils/scraper-diagnostics.js';

const ML_BASE_URL = 'https://listado.mercadolibre.com.co';


function getPlaywrightProxyConfig() {
  const raw = (process.env.PROXY_URL || '').trim();
  if (!raw) return null;

  const parsed = new URL(raw);
  const proxy = { server: `${parsed.protocol}//${parsed.host}` };
  if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
  if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
  return proxy;
}

async function safeClosePlaywright(page, context, browser) {
  try {
    await page?.close({ runBeforeUnload: false });
  } catch {
    // no-op: el navegador puede haberse cerrado antes
  }

  try {
    await context?.close();
  } catch {
    // no-op: evitar pisar el error principal
  }

  try {
    await browser?.close();
  } catch {
    // no-op: evitar pisar el error principal
  }
}


async function hasMercadoLibreNextPage(page) {
  const candidateSelectors = [
    'li.andes-pagination__button--next a',
    'a[title="Siguiente"]',
    'a.andes-pagination__link[title="Siguiente"]',
    'a[aria-label="Siguiente"]',
  ];

  for (const selector of candidateSelectors) {
    if (await page.locator(selector).count()) {
      return true;
    }
  }

  return false;
}
// Construye la URL de búsqueda de Mercado Libre a partir de la consulta search y la formatea para que sea compatible con las URLs de Mercado Libre
function buildMercadoLibreUrl(query) {
  const slug = encodeURIComponent(query.trim()).replace(/%20/g, '-');
  return `${ML_BASE_URL}/${slug}`;
}

//si en lugar de un search query viene una url, se valida que sea de mercado libre y de colombia
function isValidMercadoLibreUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'listado.mercadolibre.com.co' || parsed.hostname === 'www.mercadolibre.com.co';
  } catch {
    return false;
  }
}
//validacion de la url o el search query para determinar a donde se va a dirigir el scraper, si viene una url se valida que sea de mercado libre colombia, si viene un search query se construye la url de mercado libre con ese query, si no viene ninguno de los dos se lanza un error
function resolveMercadoLibreTargetUrl({ query, url }) {
  if (url) {
    if (!isValidMercadoLibreUrl(url)) {
      throw new AppError('URL inválida o no pertenece a Mercado Libre Colombia', 400, 'INVALID_URL');
    }
    return url;
  }

  if (query) {
    return buildMercadoLibreUrl(query);
  }

  throw new AppError('Se requiere query o url para realizar la búsqueda', 400, 'MISSING_PARAM');
}

// Función para cargar la página de resultados de Mercado Libre y manejar posibles bloqueos anti-bot o falta de resultados, si se detecta un bloqueo se lanza un error específico, si no se encuentran productos se lanza otro error específico
async function loadMercadoLibreListingPage(page, targetUrl) {
  const response = await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });

  try {
    await page.waitForSelector('li.ui-search-layout__item', { timeout: 8000 });
  } catch {
    const diagnostics = await collectPageDiagnostics(page, {
      site: 'mercadolibre',
      status: response?.status() ?? null,
      reason: 'selector_not_found',
    });

    if (
      detectChallenge({
        pageText: diagnostics.bodyPreview,
        title: diagnostics.pageTitle,
        url: diagnostics.pageUrl,
        status: diagnostics.status,
      })
    ) {
      throw new AppError(
        'Bloqueo anti-bot detectado en Mercado Libre',
        503,
        'BOT_CHALLENGE',
        diagnostics
      );
    }

    throw new AppError(
      'No se encontraron productos en Mercado Libre para la consulta',
      404,
      'NO_RESULTS',
      diagnostics
    );
  }

  return response;
}

// Función para extraer los productos de la página de resultados de Mercado Libre, recibe el objeto page de Playwright y un límite máximo de productos a extraer, devuelve un array de productos con su título, precio, URL, imagen y disponibilidad
async function extractMercadoLibreProductsFromPage(page, limit) {
  const cards = page.locator('li.ui-search-layout__item');
  const total = Math.min(await cards.count(), limit);
  const products = [];

  for (let i = 0; i < total; i += 1) {
    const card = cards.nth(i);

    const titleLocator = card.locator('a.poly-component__title');
    const title = await textOrEmpty(titleLocator);
    const productUrl = await attrOrEmpty(titleLocator, ['href']);

    const whole = await textOrEmpty(card.locator('.andes-money-amount__fraction'));
    const cents = await textOrEmpty(card.locator('.andes-money-amount__cents'));
    const priceRaw = whole && cents ? `${whole},${cents}` : whole;

    const image = await attrOrEmpty(card.locator('img'), [
      'src',
      'data-src',
      'data-recom-src',
      'data-lazy',
      'srcset',
    ]);

    if (title || productUrl) {
      products.push({
        title,
        priceRaw,
        url: productUrl,
        image,
        availabilityRaw: 'InStock',
      });
    }
  }

  return products;
}

//cuenta el número de productos listados en la página de resultados de Mercado Libre para controlar la paginación
async function getMercadoLibrePageSize(page) {
  return await page.locator('li.ui-search-layout__item').count();
}

// Función para construir la URL de la siguiente página de resultados de Mercado Libre a partir de la URL actual y el offset de paginación, maneja diferentes formatos de URL que Mercado Libre puede usar para paginar los resultados
function buildMercadoLibrePaginatedUrl(currentUrl, nextOffset) {
  const url = new URL(currentUrl);

  url.hash = '';

  let path = url.pathname;

  if (/_Desde_\d+/.test(path)) {
    path = path.replace(/_Desde_\d+/, `_Desde_${nextOffset}`);
    url.pathname = path;
    return url.toString();
  }

  if (path.includes('_NoIndex_True')) {
    path = path.replace('_NoIndex_True', `_Desde_${nextOffset}_NoIndex_True`);
    url.pathname = path;
    return url.toString();
  }

  path = `${path}_Desde_${nextOffset}_NoIndex_True`;
  url.pathname = path;

  return url.toString();
}


// Función principal para realizar el scraping en Mercado Libre recibe el parametro search o url, maxItems y headles y devuelve un objeto con los productos encontrados y meta información sobre la respuesta
export async function scrapeMercadoLibre({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
  headless = true,
}) {
  const targetUrl = resolveMercadoLibreTargetUrl({ query, url });
  const proxyConfig = getPlaywrightProxyConfig();

  const browser = await chromium.launch({
    headless,
    proxy: proxyConfig || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    locale: 'es-CO',
    viewport: { width: 1366, height: 768 },
    userAgent: buildUserAgent(),
  });

  const page = await context.newPage();

  await page.route('**/*', async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();

    const blockedTypes = ['image', 'media', 'font'];

    if (blockedTypes.includes(resourceType)) {
      return route.abort();
    }

    return route.continue();
  });

  try {
    const products = [];
    const seen = new Set();
    const visitedUrls = new Set();

    let currentUrl = targetUrl;
    let currentOffset = 1;
    let pagesVisited = 0;
    let firstStatus = null;

    while (
      currentUrl &&
      products.length < maxItems &&
      pagesVisited < maxPages &&
      !visitedUrls.has(currentUrl)
    ) {
      visitedUrls.add(currentUrl);

     let response;

      try {
        response = await loadMercadoLibreListingPage(page, currentUrl);
      } catch (error) {
        // Si ya recogiste productos de páginas anteriores y la siguiente no existe,
        // corta el loop y devuelve lo ya obtenido en vez de tumbar toda la petición
        if (error?.code === 'NO_RESULTS' && products.length > 0) {
          break;
        }

        throw error;
      }


      if (firstStatus === null) {
        firstStatus = response?.status() ?? null;
      }

      const pageSize = await getMercadoLibrePageSize(page);
      if (pageSize === 0) break;

      const remaining = maxItems - products.length;
      const pageProducts = await extractMercadoLibreProductsFromPage(page, remaining);

      let newItemsCount = 0;

      for (const product of pageProducts) {
        const dedupeKey = product.url || product.title;

        if (!dedupeKey || seen.has(dedupeKey)) continue;

        seen.add(dedupeKey);
        products.push(product);
        newItemsCount += 1;

        if (products.length >= maxItems) break;
      }

      pagesVisited += 1;

      if (products.length >= maxItems) break;
      if (newItemsCount === 0) break;

      // 👇 si no hay botón/enlace de siguiente, no intentes otra página
      const hasNextPage = await hasMercadoLibreNextPage(page);
      if (!hasNextPage) break;

      const nextOffset = currentOffset + pageSize;
      const nextUrl = buildMercadoLibrePaginatedUrl(currentUrl, nextOffset);

      if (!nextUrl || nextUrl === currentUrl || visitedUrls.has(nextUrl)) {
        break;
      }

      currentUrl = nextUrl;
      currentOffset = nextOffset;

      await page.waitForTimeout(200);
    }

    return {
      products,
      meta: {
        engine: 'playwright',
        status: firstStatus,
        finalUrl: page.url(),
        pagesVisited,
        proxy: {
          enabled: Boolean(proxyConfig),
          server: proxyConfig?.server || null,
        },
        pagination: {
          requestedMaxItems: maxItems,
          maxPages,
          collectedItems: products.length,
        },
      },
    };
  } finally {
    await safeClosePlaywright(page, context, browser);
  }
}
