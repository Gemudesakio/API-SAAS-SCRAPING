import { load as loadHtml } from 'cheerio';
import { AppError } from '../../errors/app-error.js';
import { detectChallenge } from '../../utils/scraper.helpers.js';
import { flaresolverrGet, isFlareSolverrEnabled } from '../clients/flaresolverr.client.js';

const HOMECENTER_BASE_URL = 'https://www.homecenter.com.co';
const HOMECENTER_ENGINE = 'flaresolverr';

function buildHomecenterUrl(query, page = 1) {
  const params = new URLSearchParams({ Ntt: query.trim() });
  if (page > 1) params.set('No', String((page - 1) * 48));
  return `${HOMECENTER_BASE_URL}/homecenter-co/search?${params}`;
}

function extractProductsFromNextData(html, maxItems) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s
  );
  if (!match) return [];

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const searchProps = data?.props?.pageProps?.searchProps || {};
  const results =
    searchProps.results ||
    searchProps.products ||
    searchProps.items ||
    [];

  if (Array.isArray(results) && results.length > 0) {
    return results.slice(0, maxItems).map((p) => ({
      title: String(p.displayName || p.productName || p.name || '').trim(),
      priceRaw: String(
        p.prices?.[0]?.price?.[0] ||
        p.price ||
        p.priceRange?.sellingPrice?.lowPrice ||
        ''
      ),
      url: String(p.url || p.link || ''),
      image: String(p.mediaUrls?.[0] || p.imageUrl || p.image || ''),
      availabilityRaw: p.availability ? 'DISPONIBLE' : '',
    }));
  }

  // Deep search for product arrays in the data structure
  const products = [];
  const queue = [searchProps];

  while (queue.length > 0 && products.length === 0) {
    const obj = queue.shift();
    if (!obj || typeof obj !== 'object') continue;

    for (const [, value] of Object.entries(obj)) {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === 'object' &&
        (value[0].productName || value[0].displayName || value[0].name)
      ) {
        for (const p of value.slice(0, maxItems)) {
          products.push({
            title: String(p.displayName || p.productName || p.name || '').trim(),
            priceRaw: String(
              p.prices?.[0]?.price?.[0] ||
              p.price ||
              p.priceRange?.sellingPrice?.lowPrice ||
              ''
            ),
            url: String(p.url || p.link || ''),
            image: String(p.mediaUrls?.[0] || p.imageUrl || p.image || ''),
            availabilityRaw: '',
          });
        }
        break;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        queue.push(value);
      }
    }
  }

  return products;
}

function extractProductsFromDom($, maxItems) {
  const products = [];

  const selectors = [
    '.product-card',
    '[data-testid="product-card"]',
    '.product-item',
    'article[class*="product"]',
    '[class*="ProductCard"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      if (products.length >= maxItems) return;

      const card = $(el);
      const title = card.find('h2, h3, [class*="title"], [class*="name"]').first().text().trim();
      const href = card.find('a').first().attr('href') || '';
      const url = href.startsWith('http') ? href : `${HOMECENTER_BASE_URL}${href}`;
      const priceRaw = card.find('[class*="price"], [class*="Price"]').first().text().trim();
      const image =
        card.find('img').first().attr('src') ||
        card.find('img').first().attr('data-src') ||
        '';

      if (title && url) {
        products.push({ title, priceRaw, url, image, availabilityRaw: '' });
      }
    });

    if (products.length > 0) break;
  }

  return products;
}

export async function scrapeHomecenter({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  if (!isFlareSolverrEnabled()) {
    throw new AppError(
      'Homecenter requiere FLARESOLVERR_URL configurada',
      503,
      'SCRAPER_NAVIGATION_ERROR',
      { reason: 'flaresolverr_not_configured' }
    );
  }

  if (!query?.trim() && !url) {
    throw new AppError('Se requiere query o url para Homecenter', 400, 'MISSING_PARAM');
  }

  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  let lastFinalUrl = '';
  let firstStatus = null;

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    const targetUrl = url && page === 1
      ? url
      : buildHomecenterUrl(query, page);

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

    // Try __NEXT_DATA__ first, then DOM
    let pageProducts = extractProductsFromNextData(html, maxItems - products.length);

    if (!pageProducts.length) {
      const $ = loadHtml(html);
      pageProducts = extractProductsFromDom($, maxItems - products.length);
    }

    if (!pageProducts.length) {
      if (
        detectChallenge({
          pageText: html.slice(0, 2000),
          title: '',
          url: finalUrl,
          status,
        })
      ) {
        throw new AppError(
          'Bloqueo anti-bot detectado en Homecenter',
          503,
          'BOT_CHALLENGE',
          { reason: 'cloudflare_challenge', status, url: finalUrl }
        );
      }

      if (products.length > 0) break;

      throw new AppError(
        'No se encontraron productos en Homecenter',
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
      engine: HOMECENTER_ENGINE,
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
