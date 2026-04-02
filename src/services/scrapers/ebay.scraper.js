import { load as loadHtml } from 'cheerio';
import { AppError } from '../../errors/app-error.js';
import { buildUserAgent } from '../../utils/scraper.helpers.js';
import { flaresolverrGet, isFlareSolverrEnabled } from '../clients/flaresolverr.client.js';

const EBAY_BASE_URL = 'https://www.ebay.com';

function isValidEbayUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.endsWith('ebay.com');
  } catch {
    return false;
  }
}

function buildEbayUrl(query, page = 1) {
  const params = new URLSearchParams({
    _nkw: query.trim(),
    _ipg: '60',
  });
  if (page > 1) params.set('_pgn', String(page));
  return `${EBAY_BASE_URL}/sch/i.html?${params}`;
}

function resolveEbayTargetUrl({ query, url }, page) {
  if (url) {
    if (!isValidEbayUrl(url)) {
      throw new AppError(
        'URL inválida o no pertenece a eBay',
        400,
        'INVALID_URL'
      );
    }
    if (page <= 1) return url;
    const parsed = new URL(url);
    parsed.searchParams.set('_pgn', String(page));
    return parsed.toString();
  }

  if (query?.trim()) {
    return buildEbayUrl(query, page);
  }

  throw new AppError(
    'Se requiere query o url para realizar la búsqueda',
    400,
    'MISSING_PARAM'
  );
}

function extractProductsFromHtml(html, maxItems) {
  const $ = loadHtml(html);
  const products = [];

  $('li[data-viewport]').each((_, el) => {
    if (products.length >= maxItems) return;

    const card = $(el);

    const title = card.find('[role="heading"]').first().text().trim();
    if (!title || title === 'Shop on eBay' || title.includes('Results matching')) return;

    const priceText = card
      .find('span.su-styled-text.primary.bold')
      .first()
      .text()
      .trim();

    const itemLink = card.find('a[href*="/itm/"]').first().attr('href') || '';
    const url = itemLink.split('?')[0];

    const image =
      card.find('img[src*="ebayimg"]').first().attr('src') ||
      card.find('img[data-src*="ebayimg"]').first().attr('data-src') ||
      '';

    if (title && url) {
      products.push({
        title,
        priceRaw: priceText,
        url,
        image,
        availabilityRaw: 'DISPONIBLE',
      });
    }
  });

  return products;
}

function isBlockedPage(html) {
  return (
    html.includes('Pardon Our Interruption') ||
    html.includes('Security Measure') ||
    html.includes('captcha')
  );
}

async function fetchWithFlareSolverr(targetUrl) {
  const flareData = await flaresolverrGet(targetUrl);
  const solution = flareData?.solution || {};
  return {
    html: String(solution.response || ''),
    status: Number(solution.status) || null,
    finalUrl: String(solution.url || targetUrl),
  };
}

async function fetchDirect(targetUrl) {
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': buildUserAgent(),
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    return { html: '', status: response.status, finalUrl: targetUrl };
  }

  return {
    html: await response.text(),
    status: response.status,
    finalUrl: targetUrl,
  };
}

export async function scrapeEbay({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  const useFlareSolverr = isFlareSolverrEnabled();
  const engine = useFlareSolverr ? 'flaresolverr' : 'fetch';

  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  let lastUrl = '';
  let firstStatus = null;

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    const targetUrl = resolveEbayTargetUrl({ query, url }, page);
    lastUrl = targetUrl;

    // Use FlareSolverr for ALL pages when available (like Homecenter/Decathlon).
    // eBay blocks repeated fetch requests from the same IP, so FlareSolverr must
    // handle the full session (cookies, browser state) from page 1 onward.
    const result = useFlareSolverr
      ? await fetchWithFlareSolverr(targetUrl)
      : await fetchDirect(targetUrl);

    if (firstStatus === null) firstStatus = result.status;
    pagesVisited++;

    if (!result.html || isBlockedPage(result.html)) {
      if (products.length > 0) break;

      throw new AppError(
        useFlareSolverr
          ? 'eBay bloqueó la petición incluso con FlareSolverr'
          : 'eBay bloqueó la petición. Configura FLARESOLVERR_URL para bypass automático.',
        503,
        'BOT_CHALLENGE',
        { reason: 'ebay_block', hint: useFlareSolverr ? undefined : 'Set FLARESOLVERR_URL env variable' }
      );
    }

    const pageProducts = extractProductsFromHtml(result.html, maxItems - products.length);

    if (!pageProducts.length) break;

    for (const p of pageProducts) {
      const key = p.url || p.title;
      if (seen.has(key)) continue;
      seen.add(key);
      products.push(p);
      if (products.length >= maxItems) break;
    }
  }

  return {
    products,
    meta: {
      engine,
      status: firstStatus,
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
