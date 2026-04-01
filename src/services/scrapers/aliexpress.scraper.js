import { load as loadHtml } from 'cheerio';
import { AppError } from '../../errors/app-error.js';
import { detectChallenge } from '../../utils/scraper.helpers.js';
import { flaresolverrGet, isFlareSolverrEnabled } from '../clients/flaresolverr.client.js';

const ALIEXPRESS_ENGINE = 'flaresolverr';

function isValidAliExpressUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname.endsWith('aliexpress.com') ||
      parsed.hostname.endsWith('aliexpress.us')
    );
  } catch {
    return false;
  }
}

function buildAliExpressUrl(query, page = 1) {
  const slug = query.trim().replace(/\s+/g, '-');
  const base = `https://es.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`;
  if (page > 1) return `${base}?page=${page}`;
  return base;
}

function resolveAliExpressTargetUrl({ query, url }, page) {
  if (url) {
    if (!isValidAliExpressUrl(url)) {
      throw new AppError(
        'URL inválida o no pertenece a AliExpress',
        400,
        'INVALID_URL'
      );
    }
    if (page <= 1) return url;
    const parsed = new URL(url);
    parsed.searchParams.set('page', String(page));
    return parsed.toString();
  }

  if (query?.trim()) {
    return buildAliExpressUrl(query, page);
  }

  throw new AppError(
    'Se requiere query o url para realizar la búsqueda',
    400,
    'MISSING_PARAM'
  );
}

function extractFromRunParams(html, maxItems) {
  const match = html.match(/window\.runParams\s*=\s*({.*?});\s*<\/script>/s);
  if (!match) return [];

  try {
    const data = JSON.parse(match[1]);
    const items =
      data?.data?.root?.fields?.mods?.itemList?.content ||
      data?.mods?.itemList?.content ||
      [];

    return items.slice(0, maxItems).map((item) => {
      const title = item.title?.displayTitle || item.title || '';
      const priceRaw =
        item.prices?.salePrice?.formattedPrice ||
        item.prices?.salePrice?.minPrice ||
        '';
      const productUrl = item.productDetailUrl || '';
      const url = productUrl.startsWith('//')
        ? `https:${productUrl}`
        : productUrl;
      const image = item.image?.imgUrl
        ? (item.image.imgUrl.startsWith('//') ? `https:${item.image.imgUrl}` : item.image.imgUrl)
        : '';

      return { title, priceRaw, url, image, availabilityRaw: 'DISPONIBLE' };
    });
  } catch {
    return [];
  }
}

function extractFromDom($, maxItems) {
  const products = [];

  const selectors = [
    '[class*="SearchResultList"] [class*="CardWrapper"]',
    '[class*="product-card"]',
    '.search-item-card-wrapper-gallery',
    'a[href*="/item/"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      if (products.length >= maxItems) return;

      const card = $(el);
      const title = card.find('h1, h2, h3, [class*="title"]').first().text().trim();
      const priceRaw = card.find('[class*="price"], [class*="Price"]').first().text().trim();
      const href = card.find('a[href*="/item/"]').first().attr('href') ||
        card.attr('href') || '';
      const url = href.startsWith('//') ? `https:${href}` : href;
      const image =
        card.find('img').first().attr('src') ||
        card.find('img').first().attr('data-src') ||
        '';

      if (title && url) {
        products.push({
          title,
          priceRaw,
          url: url.startsWith('http') ? url : `https://es.aliexpress.com${url}`,
          image: image.startsWith('//') ? `https:${image}` : image,
          availabilityRaw: 'DISPONIBLE',
        });
      }
    });

    if (products.length > 0) break;
  }

  return products;
}

export async function scrapeAliExpress({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  if (!isFlareSolverrEnabled()) {
    throw new AppError(
      'AliExpress requiere FLARESOLVERR_URL configurada',
      503,
      'SCRAPER_NAVIGATION_ERROR',
      { reason: 'flaresolverr_not_configured' }
    );
  }

  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  let lastFinalUrl = '';
  let firstStatus = null;

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    const targetUrl = resolveAliExpressTargetUrl({ query, url }, page);

    const flareData = await flaresolverrGet(targetUrl);
    const solution = flareData?.solution || {};

    const status = Number.isFinite(Number(solution.status))
      ? Number(solution.status)
      : null;
    const finalUrl = String(solution.url || targetUrl);
    const html = String(solution.response || '');

    if (firstStatus === null) firstStatus = status;
    lastFinalUrl = finalUrl;
    pagesVisited++;

    // Try runParams first (structured JSON), then DOM parsing
    let pageProducts = extractFromRunParams(html, maxItems - products.length);

    if (!pageProducts.length) {
      const $ = loadHtml(html);
      pageProducts = extractFromDom($, maxItems - products.length);
    }

    if (!pageProducts.length) {
      if (
        detectChallenge({
          pageText: html.slice(0, 2000),
          title: '',
          url: finalUrl,
          status,
        }) ||
        html.includes('captcha') ||
        html.includes('punish')
      ) {
        if (products.length > 0) break;
        throw new AppError(
          'Bloqueo anti-bot detectado en AliExpress. FlareSolverr no pudo resolver el CAPTCHA.',
          503,
          'BOT_CHALLENGE',
          { reason: 'aliexpress_captcha', status, url: finalUrl }
        );
      }

      if (products.length > 0) break;

      throw new AppError(
        'No se encontraron productos en AliExpress',
        404,
        'NO_RESULTS',
        { reason: 'no_products_found', status, url: finalUrl }
      );
    }

    for (const p of pageProducts) {
      const key = p.url || p.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      products.push(p);
      if (products.length >= maxItems) break;
    }
  }

  return {
    products,
    meta: {
      engine: ALIEXPRESS_ENGINE,
      status: firstStatus,
      finalUrl: lastFinalUrl,
      pagesVisited,
      pagination: {
        requestedMaxItems: maxItems,
        maxPages,
        collectedItems: products.length,
      },
    },
  };
}
