import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { AppError } from '../errors/app-error.js';
import { buildUserAgent, detectChallenge } from '../utils/scraper.helpers.js';
import { runWithScraperLimiter } from '../utils/scraper-concurrency.js';
import { getBrowser } from './clients/browser-pool.js';
import { flaresolverrGet, isFlareSolverrEnabled } from './clients/flaresolverr.client.js';
import { htmlToMarkdown } from './clients/html-cleaner.js';
import { extractWithLLM } from './clients/llm.client.js';

const PROXY_URL = (process.env.PROXY_URL || '').trim();
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : null;

const FETCH_HEADERS = {
  'User-Agent': buildUserAgent(),
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

const COOKIE_WALL_SIGNALS = [
  'manejo de cookies', 'cookie policy', 'política de cookies',
  'cookie consent', 'cookie-consent', 'cookie-banner',
  'aceptar cookies', 'accept cookies', 'acepta el uso de cookies',
  'gdpr', 'consentimiento',
];

function isBlockedResponse(html, status) {
  if (!html || html.length < 500) return true;
  if ([401, 403, 404, 429, 503].includes(status)) return true;

  const lower = html.slice(0, 8000).toLowerCase();

  // Always check for challenges/captchas (even large pages can be anti-bot screens)
  if (detectChallenge({ pageText: lower, status })) return true;

  // Cookie walls that block actual content
  if (html.length < 5000 && COOKIE_WALL_SIGNALS.some(s => lower.includes(s))) return true;

  return false;
}

async function fetchWithHttp(url, useProxy) {
  const options = { headers: FETCH_HEADERS, redirect: 'follow' };
  if (useProxy && proxyDispatcher) {
    options.dispatcher = proxyDispatcher;
  }

  const response = await undiciFetch(url, options);
  const html = await response.text();

  return {
    html,
    status: response.status,
    finalUrl: response.url || url,
    engine: useProxy ? 'fetch+proxy' : 'fetch',
  };
}

const COOKIE_ACCEPT_SELECTORS = [
  'button[id*="cookie" i][id*="accept" i]',
  'button[id*="cookie" i][id*="aceptar" i]',
  'button[class*="cookie" i][class*="accept" i]',
  'button[data-testid*="accept" i]',
  'button[aria-label*="accept" i]',
  'button[aria-label*="aceptar" i]',
  '#onetrust-accept-btn-handler',
  '.cookie-consent-accept',
  'button:has-text("Aceptar")',
  'button:has-text("Accept")',
  'button:has-text("Acepto")',
  'button:has-text("Accept All")',
  'button:has-text("Aceptar todo")',
  'button:has-text("Aceptar cookies")',
  'button:has-text("Accept Cookies")',
];

async function dismissCookieModal(page) {
  for (const selector of COOKIE_ACCEPT_SELECTORS) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 2000 });
        return true;
      }
    } catch { /* selector not found or not clickable */ }
  }
  return false;
}

async function fetchWithPlaywright(url, options = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'es-CO',
    viewport: { width: 1366, height: 768 },
    userAgent: buildUserAgent(),
  });
  const page = await context.newPage();

  await context.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) return route.abort();
    return route.continue();
  });

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeout || 25000,
    });

    // Try to dismiss cookie consent modals that block content
    await dismissCookieModal(page);

    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 8000 }).catch(() => {});
    } else {
      // Wait for meaningful content to render (SPAs need this)
      await page.waitForFunction(
        () => document.body && document.body.innerText.length > 500,
        { timeout: 12000 }
      ).catch(() => {});
    }

    const html = await page.content();

    // If content is too thin, try dismissing cookie modal again and wait more
    if (html.length < 3000) {
      const dismissed = await dismissCookieModal(page);
      if (dismissed) {
        await page.waitForFunction(
          () => document.body && document.body.innerText.length > 500,
          { timeout: 8000 }
        ).catch(() => {});
      }
    }

    const finalHtml = await page.content();

    return {
      html: finalHtml,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      engine: 'playwright',
    };
  } finally {
    try { await page?.close({ runBeforeUnload: false }); } catch { /* no-op */ }
    try { await context?.close(); } catch { /* no-op */ }
  }
}

async function fetchWithFlaresolverr(url) {
  const flareData = await flaresolverrGet(url);
  const solution = flareData?.solution || {};

  return {
    html: String(solution.response || ''),
    status: Number(solution.status) || null,
    finalUrl: String(solution.url || url),
    engine: 'flaresolverr',
  };
}

async function fetchWithCascade(url, options = {}) {
  const { render = false, proxy = false, waitFor, timeout } = options;

  // Engine 1: Direct fetch (skip if render explicitly requested)
  if (!render) {
    try {
      const result = await fetchWithHttp(url, proxy);
      if (!isBlockedResponse(result.html, result.status)) {
        return result;
      }
    } catch {
      // fetch failed — fall through to Playwright
    }
  }

  // Engine 2: Playwright (browser rendering)
  try {
    const result = await fetchWithPlaywright(url, { waitFor, timeout });
    if (!isBlockedResponse(result.html, result.status)) {
      return result;
    }
  } catch {
    // Playwright failed — fall through to FlareSolverr
  }

  // Engine 3: FlareSolverr (anti-bot last resort)
  // Only check for hard challenges — skip cookie wall check since FlareSolverr
  // pages legitimately mention cookies in footers/banners.
  if (isFlareSolverrEnabled()) {
    try {
      const result = await fetchWithFlaresolverr(url);
      if (result.html) {
        const stillBlocked = detectChallenge({
          pageText: result.html.slice(0, 8000).toLowerCase(),
          status: result.status,
        });
        if (!stillBlocked) return result;
      }
    } catch {
      // FlareSolverr failed (connection error, timeout, etc.) — fall through
    }
  }

  throw new AppError(
    'All fetch engines failed for this URL',
    502,
    'FETCH_ALL_ENGINES_FAILED',
    { url }
  );
}

export async function universalScrape({ url, prompt, model, schema, options = {} }) {
  const start = Date.now();
  const formats = options.formats || (prompt ? ['json'] : ['markdown']);
  const wantsJson = formats.includes('json');
  const wantsMarkdown = formats.includes('markdown');

  // Fetch HTML via engine cascade (respects concurrency limiter)
  const fetchResult = await runWithScraperLimiter(
    () => fetchWithCascade(url, options),
    'universal-scrape'
  );

  // Clean HTML → Markdown
  const cleaned = htmlToMarkdown(fetchResult.html, fetchResult.finalUrl);

  const result = {
    metadata: {
      url: fetchResult.finalUrl,
      title: cleaned.title,
      statusCode: fetchResult.status,
      engine: fetchResult.engine,
      contentLength: cleaned.length,
      elapsed: Date.now() - start,
    },
  };

  if (wantsMarkdown) {
    result.markdown = cleaned.markdown;
  }

  // LLM extraction (only if prompt provided and json format requested)
  if (wantsJson && prompt) {
    // resolveModel inside extractWithLLM throws specific errors per case
    const { data, tokensUsed } = await extractWithLLM(cleaned.markdown, prompt, schema, model);
    result.json = data;
    result.metadata.tokensUsed = tokensUsed.input + tokensUsed.output;
    result.metadata.llmModel = tokensUsed.model;
    if (tokensUsed.chunks) {
      result.metadata.chunks = tokensUsed.chunks;
    }
  }

  result.metadata.elapsed = Date.now() - start;

  return result;
}
