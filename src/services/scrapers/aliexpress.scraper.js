import { load as loadHtml } from 'cheerio';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { AppError } from '../../errors/app-error.js';
import { buildUserAgent, detectChallenge } from '../../utils/scraper.helpers.js';
import { flaresolverrGet, isFlareSolverrEnabled } from '../clients/flaresolverr.client.js';

const PROXY_URL = process.env.PROXY_URL || '';

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

function normalizeUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  return rawUrl;
}

async function fetchDirect(targetUrl) {
  const headers = {
    'User-Agent': buildUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
  };

  const fetchOptions = { headers, redirect: 'follow' };
  if (PROXY_URL) {
    fetchOptions.dispatcher = new ProxyAgent(PROXY_URL);
  }

  const response = await undiciFetch(targetUrl, fetchOptions);

  if (!response.ok) {
    return { html: '', status: response.status, finalUrl: targetUrl };
  }

  return {
    html: await response.text(),
    status: response.status,
    finalUrl: response.url || targetUrl,
  };
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

function isBlockedPage(html) {
  if (!html || html.length < 500) return true;
  if (html.includes('captcha') || html.includes('punish') || html.includes('_bx-verify')) return true;
  return detectChallenge({
    pageText: html.slice(0, 3000),
    title: '',
    url: '',
    status: null,
  });
}

function extractFromInlineData(html, maxItems) {
  const marker = '"itemList":{"content":[';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return [];

  const arrayStart = markerIdx + marker.length;
  const products = [];
  const seen = new Set();

  let i = arrayStart;
  while (i < html.length && products.length < maxItems) {
    while (i < html.length && (html[i] === ',' || html[i] === ' ' || html[i] === '\n')) i++;
    if (html[i] !== '{') break;

    let depth = 0;
    const objStart = i;
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    if (depth !== 0) break;

    const objStr = html.substring(objStart, i);
    let obj;
    try { obj = JSON.parse(objStr); } catch { continue; }

    const productId = obj.productId;
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);

    const title = obj.title?.displayTitle || '';
    if (!title) continue;

    const price = obj.prices?.salePrice?.minPrice;
    const priceRaw = price != null ? String(price) : '';

    const imgUrl = normalizeUrl(obj.image?.imgUrl || '');

    products.push({
      title,
      priceRaw,
      url: `https://es.aliexpress.com/item/${productId}.html`,
      image: imgUrl,
      availabilityRaw: 'DISPONIBLE',
    });
  }

  return products;
}

function extractFromDom($, maxItems) {
  const products = [];

  $('a[href*="/item/"]').each((_, el) => {
    if (products.length >= maxItems) return;

    const link = $(el);
    const href = link.attr('href') || '';
    const url = normalizeUrl(href);
    if (!url || !url.includes('/item/')) return;

    const card = link.closest('div[class]');
    const title =
      card.find('[class*="title"], h1, h2, h3').first().text().trim() ||
      link.text().trim();
    const priceRaw =
      card.find('[class*="price"], [class*="Price"]').first().text().trim();
    const image = normalizeUrl(
      card.find('img').first().attr('src') ||
      card.find('img').first().attr('data-src') ||
      ''
    );

    if (title && title.length > 3) {
      products.push({
        title,
        priceRaw,
        url: url.startsWith('http') ? url : `https://es.aliexpress.com${url}`,
        image,
        availabilityRaw: 'DISPONIBLE',
      });
    }
  });

  return products;
}

export async function scrapeAliExpress({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  const flareSolverrAvailable = isFlareSolverrEnabled();
  let useFlareSolverr = false;
  let engine = 'fetch';

  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  let lastFinalUrl = '';
  let firstStatus = null;

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    const targetUrl = resolveAliExpressTargetUrl({ query, url }, page);

    let result;

    if (useFlareSolverr) {
      result = await fetchWithFlareSolverr(targetUrl);
    } else {
      result = await fetchDirect(targetUrl);

      if (isBlockedPage(result.html)) {
        if (flareSolverrAvailable) {
          useFlareSolverr = true;
          engine = 'fetch+flaresolverr';
          result = await fetchWithFlareSolverr(targetUrl);
        } else {
          if (products.length > 0) break;
          throw new AppError(
            'AliExpress bloqueó la petición. Configura PROXY_URL o FLARESOLVERR_URL.',
            503,
            'BOT_CHALLENGE',
            { reason: 'aliexpress_block', hint: 'Set PROXY_URL env variable' }
          );
        }
      }
    }

    if (firstStatus === null) firstStatus = result.status;
    lastFinalUrl = result.finalUrl;
    pagesVisited++;

    if (!result.html || isBlockedPage(result.html)) {
      if (products.length > 0) break;
      throw new AppError(
        useFlareSolverr
          ? 'AliExpress bloqueó la petición incluso con FlareSolverr'
          : 'AliExpress bloqueó la petición',
        503,
        'BOT_CHALLENGE',
        { reason: 'aliexpress_block', engine, status: result.status }
      );
    }

    let pageProducts = extractFromInlineData(result.html, maxItems - products.length);

    if (!pageProducts.length) {
      const $ = loadHtml(result.html);
      pageProducts = extractFromDom($, maxItems - products.length);
    }

    if (!pageProducts.length) {
      if (products.length > 0) break;
      throw new AppError(
        'No se encontraron productos en AliExpress',
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
      engine,
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
