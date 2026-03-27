import { load as loadHtml } from 'cheerio';
import { AppError } from '../../errors/app-error.js';
import { absoluteUrl, detectChallenge } from '../../utils/scraper.helpers.js';
import { flaresolverrGet, isFlareSolverrEnabled } from '../clients/flaresolverr.client.js';

const DECATHLON_BASE_URL = 'https://www.decathlon.com.co';
const DECATHLON_ENGINE = 'flaresolverr';

function buildDecathlonUrl(query) {
  return `${DECATHLON_BASE_URL}/search/?query=${encodeURIComponent(query.trim())}`;
}

function isValidDecathlonUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === 'www.decathlon.com.co' ||
      parsed.hostname === 'decathlon.com.co'
    );
  } catch {
    return false;
  }
}

function resolveDecathlonTargetUrl({ query, url }) {
  if (url) {
    if (!isValidDecathlonUrl(url)) {
      throw new AppError(
        'URL inválida o no pertenece a Decathlon Colombia',
        400,
        'INVALID_URL'
      );
    }

    return url;
  }

  if (query) {
    return buildDecathlonUrl(query);
  }

  throw new AppError(
    'Se requiere query o url para realizar la búsqueda',
    400,
    'MISSING_PARAM'
  );
}

function extractImageFromNode(imageNode) {
  const src = imageNode.attr('src');
  if (src?.trim()) return src.trim();

  const dataSrc = imageNode.attr('data-src');
  if (dataSrc?.trim()) return dataSrc.trim();

  const srcset = imageNode.attr('srcset');
  if (!srcset?.trim()) return '';

  const firstCandidate = srcset
    .split(',')[0]
    ?.trim()
    ?.split(' ')[0]
    ?.trim();

  return firstCandidate || '';
}

function parseProductsFromEmbeddedData(rawJson, maxItems) {
  if (!rawJson?.trim()) return [];

  let data;

  try {
    data = JSON.parse(rawJson);
  } catch {
    return [];
  }

  const groups = Array.isArray(data?.products) ? data.products : [];
  const products = [];

  for (const group of groups) {
    const item = Array.isArray(group) ? group[0] : group;
    if (!item || typeof item !== 'object') continue;

    const title = String(item.title || '').trim();
    const amountRaw = item?.price?.amountRaw;
    const amount = item?.price?.amount;
    const priceRaw = amountRaw != null ? String(amountRaw) : String(amount || '').trim();

    const url = absoluteUrl(DECATHLON_BASE_URL, item.cardLinkUrl || '');
    const image = String(item?.image?.url || '').trim();
    const availabilityRaw = String(item?.stock?.availability || '').trim();

    if (title || url) {
      products.push({
        title,
        priceRaw,
        url,
        image,
        availabilityRaw,
      });
    }

    if (products.length >= maxItems) break;
  }

  return products;
}

function parseProductsFromEmbeddedJsonHtml($, maxItems) {
  const rawJson = $('os-product-list script[type="application/json"][data-src]')
    .first()
    .text();

  return parseProductsFromEmbeddedData(rawJson, maxItems);
}

function parseProductsFromDomHtml($, maxItems) {
  const products = [];

  $('li.js-product-card article.product-card').each((_, element) => {
    if (products.length >= maxItems) return;

    const card = $(element);

    const title = card.find('a.js-product-card-link h2').first().text().trim();
    const href = card.find('a.js-product-card-link').first().attr('href') || '';
    const url = absoluteUrl(DECATHLON_BASE_URL, href);

    const priceRaw = card.find('.price_amount').first().text().trim();
    const image = extractImageFromNode(card.find('.product-card_image img').first());

    if (title || url) {
      products.push({
        title,
        priceRaw,
        url,
        image,
        availabilityRaw: '',
      });
    }
  });

  return products;
}

function detectHasNextPage($, currentPageNumber) {
  const pageCountRaw = $('[data-page-count]').first().attr('data-page-count');
  const pageCount = Number.parseInt(pageCountRaw || '', 10);

  if (Number.isFinite(pageCount) && pageCount > 0) {
    return currentPageNumber < pageCount;
  }

  const explicitNextSelectors = [
    'a[rel="next"]',
    'a[title*="Siguiente"]',
    'a[aria-label*="Siguiente"]',
    '.pagination [aria-label*="next"]',
    '.pagination [title*="next"]',
  ];

  return explicitNextSelectors.some((selector) => $(selector).length > 0);
}

function extractDecathlonProductsFromHtml(html, limit, currentPageNumber) {
  const normalizedHtml = String(html || '');
  const $ = loadHtml(normalizedHtml);

  let products = parseProductsFromEmbeddedJsonHtml($, limit);

  if (!products.length) {
    products = parseProductsFromDomHtml($, limit);
  }

  return {
    products,
    pageTitle: $('title').first().text().trim(),
    bodyPreview: normalizedHtml.slice(0, 2000),
    hasNextPage: detectHasNextPage($, currentPageNumber),
  };
}

function buildDecathlonPaginatedUrl(currentUrl, nextPageNumber) {
  const url = new URL(currentUrl);

  url.hash = '';

  if (nextPageNumber <= 1) {
    url.searchParams.delete('page');
  } else {
    url.searchParams.set('page', String(nextPageNumber));
  }

  return url.toString();
}

function buildNoResultsDiagnostics({ status, finalUrl, pageTitle, bodyPreview }) {
  return {
    reason: 'selector_not_found',
    site: 'decathlon',
    status,
    pageUrl: finalUrl,
    pageTitle,
    bodyPreview,
    screenshotPath: null,
    htmlPath: null,
    debugEnabled: false,
  };
}

function assertFlareSolverrReady() {
  if (isFlareSolverrEnabled()) return;

  throw new AppError(
    'Decathlon requiere FLARESOLVERR_URL configurada',
    503,
    'SCRAPER_NAVIGATION_ERROR',
    {
      reason: 'flaresolverr_not_configured',
    }
  );
}

export async function scrapeDecathlon({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
  headless = true,
}) {
  void headless;

  assertFlareSolverrReady();

  const targetUrl = resolveDecathlonTargetUrl({ query, url });

  const products = [];
  const seen = new Set();
  const visitedUrls = new Set();

  let currentUrl = targetUrl;
  let currentPageNumber = 1;
  let pagesVisited = 0;
  let firstStatus = null;
  let canonicalBaseUrl = null;
  let lastFinalUrl = targetUrl;

  while (
    currentUrl &&
    products.length < maxItems &&
    pagesVisited < maxPages &&
    !visitedUrls.has(currentUrl)
  ) {
    visitedUrls.add(currentUrl);

    const flaresolverrData = await flaresolverrGet(currentUrl);
    const solution = flaresolverrData?.solution || {};

    const status = Number.isFinite(Number(solution.status))
      ? Number(solution.status)
      : null;

    const finalUrl = String(solution.url || currentUrl);
    const html = String(solution.response || '');

    if (firstStatus === null) {
      firstStatus = status;
    }

    if (!canonicalBaseUrl) {
      canonicalBaseUrl = finalUrl;
    }

    lastFinalUrl = finalUrl;

    const remaining = maxItems - products.length;
    const extracted = extractDecathlonProductsFromHtml(
      html,
      remaining,
      currentPageNumber
    );
    const pageProducts = extracted.products;

    if (!pageProducts.length) {
      const diagnostics = buildNoResultsDiagnostics({
        status,
        finalUrl,
        pageTitle: extracted.pageTitle,
        bodyPreview: extracted.bodyPreview,
      });

      if (
        detectChallenge({
          pageText: extracted.bodyPreview,
          title: extracted.pageTitle,
          url: finalUrl,
          status,
        })
      ) {
        throw new AppError(
          'Bloqueo anti-bot detectado en Decathlon',
          503,
          'BOT_CHALLENGE',
          diagnostics
        );
      }

      if (products.length > 0) break;

      throw new AppError(
        'No se encontró el listado de productos en Decathlon',
        404,
        'NO_RESULTS',
        diagnostics
      );
    }

    let newItemsCount = 0;

    for (const product of pageProducts) {
      const dedupeKey = product.url || product.title;
      if (!dedupeKey || seen.has(dedupeKey)) continue;

      seen.add(dedupeKey);
      products.push(product);
      newItemsCount += 1;

      if (products.length >= maxItems) break;
    }

    pagesVisited += 1;

    if (products.length >= maxItems) break;
    if (newItemsCount === 0) break;
    if (!extracted.hasNextPage) break;

    const nextPageNumber = currentPageNumber + 1;
    const nextUrl = buildDecathlonPaginatedUrl(canonicalBaseUrl, nextPageNumber);

    if (!nextUrl || nextUrl === currentUrl || visitedUrls.has(nextUrl)) {
      break;
    }

    currentUrl = nextUrl;
    currentPageNumber = nextPageNumber;
  }

  return {
    products,
    meta: {
      engine: DECATHLON_ENGINE,
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
