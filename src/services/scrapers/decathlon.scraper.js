import { chromium } from 'playwright';
import { AppError } from '../../errors/app-error.js';
import {
  absoluteUrl,
  attrOrEmpty,
  buildUserAgent,
  detectChallenge,
  textOrEmpty,
} from '../../utils/scraper.helpers.js';

const DECATHLON_BASE_URL = 'https://www.decathlon.com.co';

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

async function loadDecathlonListingPage(page, targetUrl) {
  const response = await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });

  try {
    await page.waitForSelector('os-product-list', { timeout: 12000 });
  } catch {
    const pageText = await page.textContent('body').catch(() => '');

    if (detectChallenge(pageText || '')) {
      throw new AppError('Bloqueo anti-bot detectado en Decathlon', 503, 'BOT_CHALLENGE');
    }

    throw new AppError(
      'No se encontró el listado de productos en Decathlon',
      404,
      'NO_RESULTS'
    );
  }

  return response;
}

async function parseProductsFromEmbeddedJson(page, maxItems) {
  const scriptLocator = page.locator('os-product-list script[type="application/json"][data-src]');

  if ((await scriptLocator.count()) === 0) return [];

  const rawJson = await scriptLocator.first().textContent();
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

async function parseProductsFromDom(page, maxItems) {
  const cards = page.locator('li.js-product-card article.product-card');
  const total = Math.min(await cards.count(), maxItems);
  const products = [];

  for (let i = 0; i < total; i += 1) {
    const card = cards.nth(i);

    const title = await textOrEmpty(card.locator('a.js-product-card-link h2'));
    const href = await attrOrEmpty(card.locator('a.js-product-card-link'), ['href']);
    const url = absoluteUrl(DECATHLON_BASE_URL, href);

    const priceRaw = await textOrEmpty(card.locator('.price_amount'));
    const image = await attrOrEmpty(card.locator('.product-card_image img'), [
      'src',
      'data-src',
      'srcset',
    ]);

    if (title || url) {
      products.push({
        title,
        priceRaw,
        url,
        image,
        availabilityRaw: '',
      });
    }
  }

  return products;
}

async function extractDecathlonProductsFromPage(page, limit) {
  let products = await parseProductsFromEmbeddedJson(page, limit);

  if (!products.length) {
    products = await parseProductsFromDom(page, limit);
  }

  return products;
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

export async function scrapeDecathlon({
  query,
  url,
  maxItems = 20,
  maxPages = 3,
  headless = true,
}) {
  const targetUrl = resolveDecathlonTargetUrl({ query, url });

  const browser = await chromium.launch({
  headless,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ],
});

  const context = await browser.newContext({
    locale: 'es-CO',
    viewport: { width: 1366, height: 768 },
    userAgent: buildUserAgent(),
  });

  const page = await context.newPage();

  await page.route('**/*', async (route) => {
    const resourceType = route.request().resourceType();
    const blockedTypes = ['image', 'media', 'font'];

    if (blockedTypes.includes(resourceType)) {
      return route.abort();
    }

    return route.continue();
  });

  try {
    const products = [];
    const seen = new Set();
    const visitedUrls = new Set();

    let currentUrl = targetUrl;
    let currentPageNumber = 1;
    let pagesVisited = 0;
    let firstStatus = null;
    let canonicalBaseUrl = null;

    while (
      currentUrl &&
      products.length < maxItems &&
      pagesVisited < maxPages &&
      !visitedUrls.has(currentUrl)
    ) {
      visitedUrls.add(currentUrl);

      let response;

      try {
        response = await loadDecathlonListingPage(page, currentUrl);
      } catch (error) {
        if (error?.code === 'NO_RESULTS' && products.length > 0) {
          break;
        }

        throw error;
      }

      if (firstStatus === null) {
        firstStatus = response?.status() ?? null;
      }

      if (!canonicalBaseUrl) {
        canonicalBaseUrl = page.url();
      }

      const remaining = maxItems - products.length;
      const pageProducts = await extractDecathlonProductsFromPage(page, remaining);

      if (!pageProducts.length) {
        break;
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

      const nextPageNumber = currentPageNumber + 1;
      const nextUrl = buildDecathlonPaginatedUrl(canonicalBaseUrl, nextPageNumber);

      if (!nextUrl || nextUrl === currentUrl || visitedUrls.has(nextUrl)) {
        break;
      }

      currentUrl = nextUrl;
      currentPageNumber = nextPageNumber;

      await page.waitForTimeout(400);
    }

    return {
      products,
      meta: {
        status: firstStatus,
        finalUrl: page.url(),
        pagesVisited,
        pagination: {
          requestedMaxItems: maxItems,
          maxPages,
          collectedItems: products.length,
        },
      },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}