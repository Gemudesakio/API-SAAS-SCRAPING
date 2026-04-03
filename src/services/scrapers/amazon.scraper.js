import { load as loadHtml } from 'cheerio';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { AppError } from '../../errors/app-error.js';
import { buildUserAgent, detectChallenge } from '../../utils/scraper.helpers.js';
import {
  flaresolverrGet,
  isFlareSolverrEnabled,
} from '../clients/flaresolverr.client.js';
import { convertToCOP } from '../../utils/currency.js';

const AMAZON_BASE_URL = 'https://www.amazon.com';
const PROXY_URL = process.env.PROXY_URL || '';

function isValidAmazonUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname.endsWith('amazon.com') ||
      parsed.hostname.endsWith('amazon.com.mx')
    );
  } catch {
    return false;
  }
}

function ensureColombianDelivery(parsed) {
  if (!parsed.searchParams.has('delivery')) {
    parsed.searchParams.set('delivery', 'countryCode:CO');
  }
  if (!parsed.searchParams.has('dc')) {
    parsed.searchParams.set('dc', '');
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
    const parsed = new URL(url);
    ensureColombianDelivery(parsed);
    if (page > 1) parsed.searchParams.set('page', String(page));
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

function parseAmazonPrice(card, $) {
  let bestPrice = '';

  card.find('.a-price').each((_, priceContainer) => {
    if (bestPrice) return;
    const container = $(priceContainer);
    if (container.attr('data-a-strike') === 'true') return;
    if (container.closest('.a-text-price').length > 0) return;

    const offscreen = container.find('.a-offscreen').first().text().trim();
    if (offscreen) bestPrice = offscreen;
  });

  if (bestPrice) return bestPrice;

  const whole = card.find('.a-price-whole').first().text().trim().replace(/\.$/, '');
  const fraction = card.find('.a-price-fraction').first().text().trim();
  if (whole) return fraction ? `${whole}.${fraction}` : whole;

  return '';
}

function extractProductsFromHtml(html, maxItems) {
  const $ = loadHtml(html);
  const products = [];

  $('[data-component-type="s-search-result"]').each((_, el) => {
    if (products.length >= maxItems) return;

    const card = $(el);
    const asin = card.attr('data-asin') || '';
    if (!asin) return;
    if (card.hasClass('AdHolder')) return;

    const title =
      card.find('h2 a span').first().text().trim() ||
      card.find('a.s-line-clamp-4, a.s-line-clamp-3, a.s-line-clamp-2').first().text().trim() ||
      card.find('h2 span').first().text().trim();
    if (!title) return;

    const priceRaw = parseAmazonPrice(card, $);
    if (!priceRaw) return;

    let href = '';
    card.find('a.a-link-normal').each((_, a) => {
      const h = $(a).attr('href') || '';
      if (!href && h.includes('/dp/')) href = h;
    });
    if (!href) {
      card.find('a[href*="/dp/"]').each((_, a) => {
        if (!href) href = $(a).attr('href') || '';
      });
    }
    if (!href) return;

    const fullUrl = href.startsWith('http') ? href : `${AMAZON_BASE_URL}${href}`;

    const image = card.find('img.s-image').first().attr('src') || '';

    const deliveryText = card
      .find('[data-cy="delivery-recipe"]')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (
      deliveryText.includes('no puede enviarse') ||
      deliveryText.includes('cannot be shipped') ||
      deliveryText.includes('Currently unavailable') ||
      deliveryText.includes('No disponible')
    ) return;

    // With a Colombian proxy, delivery texts always contain "Colombia"
    // for shippable products. Filter out non-Colombia products.
    if (PROXY_URL && !deliveryText.includes('Colombia')) return;

    products.push({
      title,
      priceRaw,
      url: fullUrl.split('/ref=')[0],
      image,
      availabilityRaw: deliveryText,
    });
  });

  return products;
}

function isBlockedPage(html) {
  if (!html || html.length < 500) return true;

  if (html.includes('captchacharacters') || html.includes('validateCaptcha')) {
    return true;
  }

  return detectChallenge({
    pageText: html.slice(0, 3000),
    title: '',
    url: '',
    status: null,
  });
}

async function fetchDirect(targetUrl) {
  const headers = {
    'User-Agent': buildUserAgent(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
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

export async function scrapeAmazon({
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
  let lastUrl = '';
  let firstStatus = null;

  for (let page = 1; page <= maxPages && products.length < maxItems; page++) {
    const targetUrl = resolveAmazonTargetUrl({ query, url }, page);
    lastUrl = targetUrl;

    let result;

    if (useFlareSolverr) {
      result = await fetchWithFlareSolverr(targetUrl);
    } else {
      result = await fetchDirect(targetUrl);

      if (isBlockedPage(result.html)) {
        if (!flareSolverrAvailable) {
          if (products.length > 0) break;
          throw new AppError(
            'Amazon CAPTCHA detectado. Configura FLARESOLVERR_URL para bypass automático.',
            503,
            'BOT_CHALLENGE',
            { reason: 'amazon_captcha', hint: 'Set FLARESOLVERR_URL env variable' }
          );
        }

        useFlareSolverr = true;
        engine = 'fetch+flaresolverr';
        result = await fetchWithFlareSolverr(targetUrl);
      }
    }

    if (firstStatus === null) firstStatus = result.status;
    pagesVisited++;

    if (!result.html || isBlockedPage(result.html)) {
      if (products.length > 0) break;
      throw new AppError(
        useFlareSolverr
          ? 'Amazon bloqueó la petición incluso con FlareSolverr'
          : 'Amazon CAPTCHA detectado',
        503,
        'BOT_CHALLENGE',
        { reason: 'amazon_captcha', engine, status: result.status }
      );
    }

    const pageProducts = extractProductsFromHtml(result.html, maxItems - products.length);

    for (const p of pageProducts) {
      const usdAmount = parseFloat(p.priceRaw.replace(/[^0-9.]/g, '')) || 0;
      if (usdAmount > 0) p.priceRaw = String(await convertToCOP(usdAmount));
    }

    if (!pageProducts.length) {
      if (products.length > 0) break;
      throw new AppError(
        'No se encontraron productos en Amazon',
        404,
        'NO_RESULTS',
        { reason: 'no_products_found', status: result.status, url: result.finalUrl }
      );
    }

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
