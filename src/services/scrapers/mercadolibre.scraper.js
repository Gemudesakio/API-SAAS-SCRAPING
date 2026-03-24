import { chromium } from 'playwright';
import { AppError } from '../../errors/app-error.js';
import { attrOrEmpty, buildUserAgent, detectChallenge, textOrEmpty } from '../../utils/scraper.helpers.js';

const ML_BASE_URL = 'https://listado.mercadolibre.com.co';

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

// Función principal para realizar el scraping en Mercado Libre recibe el parametro search o url, maxItems y headles y devuelve un objeto con los productos encontrados y meta información sobre la respuesta
export async function scrapeMercadoLibre({ query, url, maxItems = 20, headless = true }) {
  let targetUrl;
  if (url) {
    if (!isValidMercadoLibreUrl(url)) {
      throw new AppError('URL inválida o no pertenece a Mercado Libre Colombia', 400, 'INVALID_URL');
    }
    targetUrl = url;
  } else if (query) {
    targetUrl = buildMercadoLibreUrl(query);
  } else {
    throw new AppError('Se requiere query o url para realizar la búsqueda', 400, 'MISSING_PARAM');
  }

  const browser = await chromium.launch({
    headless,
    args: ['--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    locale: 'es-CO',
    viewport: { width: 1366, height: 768 },
    userAgent: buildUserAgent(),
  });

  const page = await context.newPage();

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
    }

    try {
      await page.waitForSelector('li.ui-search-layout__item', { timeout: 20000 });
    } catch {
      const pageText = await page.textContent('body').catch(() => '');
      if (detectChallenge(pageText || '')) {
        throw new AppError('Bloqueo anti-bot detectado en Mercado Libre', 503, 'BOT_CHALLENGE');
      }
      throw new AppError('No se encontraron productos en Mercado Libre para la consulta', 404, 'NO_RESULTS');
    }

    await page.waitForTimeout(1000);

    const cards = page.locator('li.ui-search-layout__item');
    const total = Math.min(await cards.count(), maxItems);
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

    return {
      products,
      meta: {
        status: response?.status() ?? null,
        finalUrl: page.url(),
      },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}