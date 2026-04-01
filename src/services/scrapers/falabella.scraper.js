import { AppError } from '../../errors/app-error.js';
import { buildUserAgent } from '../../utils/scraper.helpers.js';

const FALABELLA_BASE_URL = 'https://www.falabella.com.co';
const FALABELLA_ENGINE = 'fetch';

function buildFalabellaUrl(query, page = 1) {
  const base = `${FALABELLA_BASE_URL}/falabella-co/search`;
  const params = new URLSearchParams({ Ntt: query.trim() });
  if (page > 1) params.set('page', String(page));
  return `${base}?${params}`;
}

function extractNextData(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s
  );
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function getBestPrice(prices = []) {
  const internetPrice = prices.find((p) => p.type === 'internetPrice' && !p.crossed);
  const normalPrice = prices.find((p) => p.type === 'normalPrice' && !p.crossed);
  const cmrPrice = prices.find((p) => p.type === 'cmrPrice' && !p.crossed);

  const chosen = internetPrice || normalPrice || cmrPrice || prices[0];
  if (!chosen?.price?.[0]) return '';

  return String(chosen.price[0]);
}

function mapAvailability(availability = {}) {
  const hasDelivery = !!(
    availability.homeDeliveryShipping ||
    availability.pickUpFromStoreShipping ||
    availability.expressShipping
  );
  return hasDelivery ? 'DISPONIBLE' : '';
}

export async function scrapeFalabella({
  query,
  maxItems = 20,
  maxPages = 3,
}) {
  if (!query?.trim()) {
    throw new AppError('Se requiere query para Falabella', 400, 'MISSING_PARAM');
  }

  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  let lastUrl = '';

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    const url = buildFalabellaUrl(query, page);
    lastUrl = url;

    const response = await fetch(url, {
      headers: {
        'User-Agent': buildUserAgent(),
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      if (products.length > 0) break;
      throw new AppError(
        `Falabella HTTP error: ${response.status}`,
        502,
        'SCRAPER_NAVIGATION_ERROR',
        { status: response.status }
      );
    }

    const html = await response.text();
    const nextData = extractNextData(html);

    if (!nextData) {
      if (products.length > 0) break;
      throw new AppError(
        'No se encontró __NEXT_DATA__ en Falabella',
        404,
        'NO_RESULTS',
        { reason: 'next_data_not_found' }
      );
    }

    const results = nextData?.props?.pageProps?.results || [];
    pagesVisited++;

    if (!results.length) break;

    for (const r of results) {
      if (products.length >= maxItems) break;

      const productUrl = String(r.url || '');
      if (seen.has(productUrl)) continue;
      seen.add(productUrl);

      products.push({
        title: String(r.displayName || '').trim(),
        priceRaw: getBestPrice(r.prices),
        url: productUrl,
        image: r.mediaUrls?.[0] || '',
        availabilityRaw: mapAvailability(r.availability),
      });
    }

    const pagination = nextData?.props?.pageProps?.pagination || {};
    if (page >= (pagination.count || 1)) break;
  }

  return {
    products,
    meta: {
      engine: FALABELLA_ENGINE,
      status: 200,
      finalUrl: lastUrl,
      pagesVisited,
      pagination: {
        requestedMaxItems: maxItems,
        maxPages,
        collectedItems: products.length,
      },
    },
  };
}
