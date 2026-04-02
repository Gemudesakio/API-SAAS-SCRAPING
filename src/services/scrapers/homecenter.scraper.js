import { AppError } from '../../errors/app-error.js';
import { buildUserAgent } from '../../utils/scraper.helpers.js';

const HOMECENTER_BASE_URL = 'https://www.homecenter.com.co';
const HOMECENTER_ENGINE = 'fetch';

function isValidHomecenterUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === 'www.homecenter.com.co' ||
      parsed.hostname === 'homecenter.com.co'
    );
  } catch {
    return false;
  }
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

function extractProducts(nextData, maxItems) {
  const results =
    nextData?.props?.pageProps?.searchProps?.searchData?.results || [];

  return results.slice(0, maxItems).map((p) => ({
    title: String(p.displayName || '').trim(),
    priceRaw: String(p.prices?.[0]?.price || ''),
    priceNumeric: p.prices?.[0]?.priceWithoutFormatting || null,
    url: `${HOMECENTER_BASE_URL}/homecenter-co/product/${p.productId}`,
    image: String(p.mediaUrls?.[0] || ''),
    brand: String(p.brand || ''),
    rating: p.rating || null,
    availabilityRaw: 'DISPONIBLE',
  }));
}

function getPagination(nextData) {
  return nextData?.props?.pageProps?.searchProps?.searchData?.pagination || {};
}

async function fetchHomecenter(targetUrl) {
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': buildUserAgent(),
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-CO,es;q=0.9',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    return { html: '', status: response.status, finalUrl: response.url };
  }

  return {
    html: await response.text(),
    status: response.status,
    finalUrl: response.url,
  };
}

export async function scrapeHomecenter({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  if (!query?.trim() && !url) {
    throw new AppError('Se requiere query o url para Homecenter', 400, 'MISSING_PARAM');
  }

  if (url && !isValidHomecenterUrl(url)) {
    throw new AppError(
      'URL inválida o no pertenece a Homecenter Colombia',
      400,
      'INVALID_URL'
    );
  }

  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  let lastFinalUrl = '';
  let firstStatus = null;
  let categoryUrl = null;

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    let targetUrl;

    if (page === 1) {
      targetUrl = url || `${HOMECENTER_BASE_URL}/homecenter-co/search?Ntt=${encodeURIComponent(query.trim())}`;
    } else {
      if (!categoryUrl) break;
      const parsed = new URL(categoryUrl);
      parsed.searchParams.set('currentpage', String(page));
      targetUrl = parsed.toString();
    }

    const result = await fetchHomecenter(targetUrl);

    if (firstStatus === null) firstStatus = result.status;
    lastFinalUrl = result.finalUrl;
    pagesVisited++;

    if (!result.html) {
      if (products.length > 0) break;
      throw new AppError(
        `Homecenter HTTP error: ${result.status}`,
        502,
        'SCRAPER_NAVIGATION_ERROR',
        { status: result.status }
      );
    }

    const nextData = extractNextData(result.html);
    if (!nextData) {
      if (products.length > 0) break;
      throw new AppError(
        'No se pudo extraer datos de Homecenter',
        502,
        'SCRAPER_NAVIGATION_ERROR',
        { reason: 'no_next_data', url: result.finalUrl }
      );
    }

    if (page === 1) {
      categoryUrl = result.finalUrl;
    }

    const pageProducts = extractProducts(nextData, maxItems - products.length);

    if (!pageProducts.length) {
      if (products.length > 0) break;
      throw new AppError(
        'No se encontraron productos en Homecenter',
        404,
        'NO_RESULTS',
        { reason: 'no_products_found', status: result.status, url: result.finalUrl }
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
