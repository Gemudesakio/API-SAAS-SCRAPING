import { AppError } from '../../errors/app-error.js';
import { buildUserAgent } from '../../utils/scraper.helpers.js';

const IMPRESEE_URL =
  'https://api.impresee.com/ImpreseeSearch/api/v3/search/text/1d3d860f-8d17-4d79-a0d7-e21dd560c778';
const PEPEGANGA_ENGINE = 'fetch';
const PEPEGANGA_BASE = 'https://www.pepeganga.com';

function isValidPepeGangaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === 'www.pepeganga.com' ||
      parsed.hostname === 'pepeganga.com'
    );
  } catch {
    return false;
  }
}

function extractQueryFromPepeGangaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    // ?_q=segway&map=ft → "segway"
    const q = parsed.searchParams.get('_q');
    if (q?.trim()) return q.trim();

    // ?q=segway
    const q2 = parsed.searchParams.get('q');
    if (q2?.trim()) return q2.trim();

    // /segway or /deportes/patinetas-electricas → last segment
    const segments = parsed.pathname.replace(/^\//, '').split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return last.replace(/-/g, ' ').trim();
  } catch {
    // fall through
  }
  return null;
}

function resolvePepeGangaQuery({ query, url }) {
  if (query?.trim()) return query.trim();

  if (url) {
    if (!isValidPepeGangaUrl(url)) {
      throw new AppError(
        'URL inválida o no pertenece a PepeGanga',
        400,
        'INVALID_URL'
      );
    }

    const extracted = extractQueryFromPepeGangaUrl(url);
    if (extracted) return extracted;

    throw new AppError(
      'No se pudo extraer el término de búsqueda de la URL de PepeGanga. Usa el parámetro "query" en su lugar.',
      400,
      'MISSING_PARAM',
      { url, hint: 'La URL debe contener ?_q= o ser una página de búsqueda/categoría' }
    );
  }

  throw new AppError(
    'Se requiere query o url para realizar la búsqueda',
    400,
    'MISSING_PARAM'
  );
}

function decodeImpreseeUrl(impreseeUrl) {
  try {
    const match = impreseeUrl.match(/\/go\/([A-Za-z0-9+/=_-]+)/);
    if (!match) return impreseeUrl;

    const encoded = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');

    const urlMatch = decoded.match(/https?:\/\/[^\t\n]+/);
    return urlMatch ? urlMatch[0].split('\t')[0] : impreseeUrl;
  } catch {
    return impreseeUrl;
  }
}

export async function scrapePepeGanga({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  const resolvedQuery = resolvePepeGangaQuery({ query, url });

  const products = [];
  let pagesVisited = 0;
  const pageSize = Math.min(maxItems, 50);

  for (let page = 0; page < maxPages && products.length < maxItems; page++) {
    const body = {
      query_text: resolvedQuery,
      query_id: null,
      page_size: pageSize,
      num_page: page,
      search_type: 'FULL',
      search_filter: [],
      search_reorder: '',
      is_mobile: 'true',
      num_suggestions: 0,
      is_suggested_search: 'false',
      is_from_first: page === 0 ? 'true' : 'false',
      where: [],
      loaded_from_url_params: 'false',
    };

    const response = await fetch(IMPRESEE_URL, {
      method: 'POST',
      headers: {
        'User-Agent': buildUserAgent(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new AppError(
        `PepeGanga API error: ${response.status}`,
        502,
        'SCRAPER_NAVIGATION_ERROR',
        { status: response.status }
      );
    }

    const data = await response.json();
    const rawProducts = Array.isArray(data.products) ? data.products : [];
    pagesVisited++;

    if (!rawProducts.length) break;

    for (const p of rawProducts) {
      if (products.length >= maxItems) break;

      const rawUrl = String(p.url || '');
      const url = rawUrl.startsWith('https://api.impresee.com')
        ? decodeImpreseeUrl(rawUrl)
        : rawUrl || `${PEPEGANGA_BASE}/p?skuId=${p.id}`;

      products.push({
        title: String(p.name || '').trim(),
        priceRaw: String(p.price || ''),
        url,
        image: String(p.image || ''),
        availabilityRaw: 'DISPONIBLE',
      });
    }

    if (page + 1 >= (data.total_pages || 1)) break;
  }

  return {
    products,
    meta: {
      engine: PEPEGANGA_ENGINE,
      status: 200,
      finalUrl: IMPRESEE_URL,
      pagesVisited,
      pagination: {
        requestedMaxItems: maxItems,
        maxPages,
        collectedItems: products.length,
      },
    },
  };
}
