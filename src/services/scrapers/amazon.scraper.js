import { load as loadHtml } from 'cheerio';
import { AppError } from '../../errors/app-error.js';
import { buildUserAgent } from '../../utils/scraper.helpers.js';

const AMAZON_BASE_URL = 'https://www.amazon.com';
const AMAZON_ENGINE = 'fetch';

function isValidAmazonUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.endsWith('amazon.com') || parsed.hostname.endsWith('amazon.com.mx');
  } catch {
    return false;
  }
}

function buildAmazonUrl(query, page = 1) {
  const params = new URLSearchParams({ k: query.trim() });
  params.set('dc', '');
  params.set('delivery', 'countryCode:CO');
  if (page > 1) params.set('page', String(page));
  return `${AMAZON_BASE_URL}/s?${params}`;
}

function resolveAmazonTargetUrl({ query, url }, page) {
  if (url) {
    if (!isValidAmazonUrl(url)) {
      throw new AppError(
        'URL inválida o no pertenece a Amazon',
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
    return buildAmazonUrl(query, page);
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

  $('[data-component-type="s-search-result"]').each((_, el) => {
    if (products.length >= maxItems) return;

    const card = $(el);
    const asin = card.attr('data-asin') || '';
    if (!asin) return;

    // Title: full product name is in the clickable link with class s-line-clamp
    // Fallback to h2 span (which may only contain the brand name)
    const title =
      card.find('a.s-line-clamp-4, a.s-line-clamp-3, a.s-line-clamp-2').first().text().trim() ||
      card.find('h2 span').first().text().trim();
    if (!title) return;

    // Price: .a-offscreen contains the full formatted price (e.g. "COP 74,830.26")
    const priceRaw = card.find('.a-price .a-offscreen').first().text().trim();

    // URL: first <a> with href containing /dp/ (product detail page)
    let href = '';
    card.find('a.a-link-normal').each((_, a) => {
      const h = $(a).attr('href') || '';
      if (!href && h.includes('/dp/')) href = h;
    });
    if (!href) href = card.find('a').first().attr('href') || '';
    const fullUrl = href.startsWith('http') ? href : `${AMAZON_BASE_URL}${href}`;

    // Image
    const image = card.find('img.s-image').first().attr('src') || '';

    products.push({
      title,
      priceRaw,
      url: fullUrl.split('/ref=')[0], // clean tracking params
      image,
      availabilityRaw: 'DISPONIBLE',
    });
  });

  return products;
}

export async function scrapeAmazon({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
}) {
  const products = [];
  const seen = new Set();
  let pagesVisited = 0;
  let lastUrl = '';

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    const targetUrl = resolveAmazonTargetUrl({ query, url }, page);
    lastUrl = targetUrl;

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': buildUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
      },
    });

    if (!response.ok) {
      if (products.length > 0) break;
      throw new AppError(
        `Amazon HTTP error: ${response.status}`,
        502,
        'SCRAPER_NAVIGATION_ERROR',
        { status: response.status }
      );
    }

    const html = await response.text();

    // Detect CAPTCHA block
    if (html.includes('captchacharacters') || html.includes('validateCaptcha')) {
      if (products.length > 0) break;
      throw new AppError(
        'Amazon CAPTCHA detectado. Intenta nuevamente más tarde o usa un proxy.',
        503,
        'BOT_CHALLENGE',
        { reason: 'amazon_captcha' }
      );
    }

    const pageProducts = extractProductsFromHtml(html, maxItems - products.length);
    pagesVisited++;

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
      engine: AMAZON_ENGINE,
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
