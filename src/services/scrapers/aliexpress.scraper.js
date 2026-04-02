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

function normalizeUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('//')) return `https:${rawUrl}`;
  return rawUrl;
}

function extractFromInlineData(html, maxItems) {
  // AliExpress embeds search results in itemList.content[] inside a <script> bundle.
  // Only extract from this section to avoid mixing in recommendation products.
  const marker = '"itemList":{"content":[';
  const itemListStart = html.indexOf(marker);
  if (itemListStart === -1) return [];

  const contentStart = itemListStart + marker.length;
  const contentSlice = html.substring(contentStart, contentStart + 500000);

  const products = [];
  const seen = new Set();

  const productIdMatches = [...contentSlice.matchAll(/"productId":"(\d+)"/g)];

  for (const match of productIdMatches) {
    if (products.length >= maxItems) break;

    const productId = match[1];
    if (seen.has(productId)) continue;
    seen.add(productId);

    const start = Math.max(0, match.index - 500);
    const end = Math.min(contentSlice.length, match.index + 3000);
    const chunk = contentSlice.substring(start, end);

    const title =
      chunk.match(/"displayTitle":"([^"]+)"/)?.[1] ||
      chunk.match(/"productTitle":"([^"]+)"/)?.[1] ||
      '';

    const priceRaw =
      chunk.match(/"formattedPrice":"([^"]+)"/)?.[1] ||
      chunk.match(/"minPrice":(\d+)/)?.[1] ||
      '';

    const imgUrl = normalizeUrl(
      chunk.match(/"imgUrl":"([^"]+)"/)?.[1] || ''
    );

    if (!title) continue;

    products.push({
      title,
      priceRaw: String(priceRaw),
      url: `https://es.aliexpress.com/item/${productId}.html`,
      image: imgUrl,
      availabilityRaw: 'DISPONIBLE',
    });
  }

  return products;
}

function extractFromDom($, maxItems) {
  const products = [];

  // Fallback: find all links to product detail pages
  $('a[href*="/item/"]').each((_, el) => {
    if (products.length >= maxItems) return;

    const link = $(el);
    const href = link.attr('href') || '';
    const url = normalizeUrl(href);
    if (!url || !url.includes('/item/')) return;

    // Walk up to find the product card container
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

    // Strategy 1: Extract from inline JS data (itemList.content[])
    let pageProducts = extractFromInlineData(html, maxItems - products.length);

    // Strategy 2: Fallback to DOM parsing
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
