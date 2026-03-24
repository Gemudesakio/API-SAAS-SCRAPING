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
    const availabilityRaw = String(item?.stock?.availability || '');

    if (title || url) {
      products.push({ title, priceRaw, url, image, availabilityRaw });
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

export async function scrapeDecathlon({ query, url, maxItems = 20, headless = true }) {
  const targetUrl = resolveDecathlonTargetUrl({ query, url });

  const browser = await chromium.launch({
    headless,
    args: ['--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    locale: 'es-CO',
    viewport: { width: 1366, height: 768 },
    userAgent: buildUserAgent(),
  });

  const page = await context.newPage();

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: 20000 });
    } catch (error) {
      if (error?.name !== 'TimeoutError') throw error;
    }

    try {
      await page.waitForSelector('os-product-list', { timeout: 20000 });
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

    await page.waitForTimeout(1000);

    let products = await parseProductsFromEmbeddedJson(page, maxItems);

    if (!products.length) {
      products = await parseProductsFromDom(page, maxItems);
    }

    return {
      products,
      meta: {
        status: response?.status() ?? null,
        finalUrl: page.url(),
      },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}