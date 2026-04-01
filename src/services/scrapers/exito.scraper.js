import { AppError } from '../../errors/app-error.js';
import { buildUserAgent } from '../../utils/scraper.helpers.js';

const EXITO_BASE_URL = 'https://www.exito.com';
const EXITO_API_PATH = '/api/catalog_system/pub/products/search/';
const EXITO_ENGINE = 'fetch';
const EXCLUDED_SELLERS = ['cosas inteligentes'];

function isValidExitoUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === 'www.exito.com' ||
      parsed.hostname === 'exito.com' ||
      parsed.hostname === 'tienda.exito.com'
    );
  } catch {
    return false;
  }
}

function extractQueryFromExitoUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    // /s?q=segway&sort=price_asc → "segway"
    const qParam = parsed.searchParams.get('q');
    if (qParam?.trim()) return qParam.trim();

    // /s?Ntt=segway → "segway"
    const ntt = parsed.searchParams.get('Ntt');
    if (ntt?.trim()) return ntt.trim();

    // /tecnologia/patinetas-electricas → "patinetas electricas"
    const segments = parsed.pathname
      .replace(/^\//, '')
      .replace(/\/p$/, '')
      .split('/')
      .filter(Boolean);

    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      return lastSegment.replace(/-/g, ' ').trim();
    }
  } catch {
    // fall through
  }

  return null;
}

function resolveExitoQuery({ query, url }) {
  if (query?.trim()) return query.trim();

  if (url) {
    if (!isValidExitoUrl(url)) {
      throw new AppError(
        'URL inválida o no pertenece a Éxito Colombia',
        400,
        'INVALID_URL'
      );
    }

    const extracted = extractQueryFromExitoUrl(url);
    if (extracted) return extracted;

    throw new AppError(
      'No se pudo extraer el término de búsqueda de la URL de Éxito. Usa el parámetro "query" en su lugar.',
      400,
      'MISSING_PARAM',
      { url, hint: 'La URL debe contener ?q= o ser una página de búsqueda/categoría' }
    );
  }

  throw new AppError(
    'Se requiere query o url para realizar la búsqueda',
    400,
    'MISSING_PARAM'
  );
}

function buildExitoUrl(query, from, to) {
  const encoded = encodeURIComponent(query.trim());
  return `${EXITO_BASE_URL}${EXITO_API_PATH}${encoded}?_from=${from}&_to=${to}`;
}

function getBestOffer(sellers = []) {
  const validSellers = sellers.filter((s) => {
    const name = (s.sellerName || '').trim().toLowerCase();
    return !EXCLUDED_SELLERS.includes(name);
  });

  const available = validSellers.filter(
    (s) => (s.commertialOffer?.AvailableQuantity || 0) > 0
  );

  const pool = available.length > 0 ? available : validSellers;
  if (!pool.length) return null;

  return pool.reduce((best, s) => {
    const price = s.commertialOffer?.Price || 0;
    const bestPrice = best.commertialOffer?.Price || 0;
    return price > 0 && (bestPrice === 0 || price < bestPrice) ? s : best;
  }, pool[0]);
}

export async function scrapeExito({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  const resolvedQuery = resolveExitoQuery({ query, url });

  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  const pageSize = Math.min(maxItems, 50);
  let lastUrl = '';

  for (let page = 0; page < maxPages && products.length < maxItems; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const apiUrl = buildExitoUrl(resolvedQuery, from, to);
    lastUrl = apiUrl;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': buildUserAgent(),
        Accept: 'application/json',
      },
      redirect: 'follow',
    });

    // VTEX returns 206 (Partial Content) which is normal
    if (!response.ok && response.status !== 206) {
      if (products.length > 0) break;
      throw new AppError(
        `Éxito API error: ${response.status}`,
        502,
        'SCRAPER_NAVIGATION_ERROR',
        { status: response.status }
      );
    }

    const data = await response.json();
    const rawProducts = Array.isArray(data) ? data : [];
    pagesVisited++;

    if (!rawProducts.length) break;

    for (const p of rawProducts) {
      if (products.length >= maxItems) break;

      const productUrl = String(p.link || '');
      if (seen.has(productUrl)) continue;
      seen.add(productUrl);

      const firstItem = p.items?.[0];
      const sellers = firstItem?.sellers || [];
      const bestOffer = getBestOffer(sellers);

      if (!bestOffer) continue;

      const price = bestOffer.commertialOffer?.Price || 0;
      const availableQty = bestOffer.commertialOffer?.AvailableQuantity || 0;
      const image = firstItem?.images?.[0]?.imageUrl || '';

      products.push({
        title: String(p.productName || '').trim(),
        priceRaw: String(price),
        url: productUrl,
        image,
        availabilityRaw: availableQty > 0 ? 'DISPONIBLE' : 'AGOTADO',
      });
    }

    // If we got fewer products than page size, no more pages
    if (rawProducts.length < pageSize) break;
  }

  return {
    products,
    meta: {
      engine: EXITO_ENGINE,
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
