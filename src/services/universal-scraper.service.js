import { fetch as undiciFetch } from 'undici';
import { load as loadHtml } from 'cheerio';
import { AppError } from '../errors/app-error.js';
import { buildUserAgent, detectChallenge, getPlaywrightProxyConfig } from '../utils/scraper.helpers.js';
import { runWithScraperLimiter } from '../utils/scraper-concurrency.js';
import { getBrowser } from './clients/browser-pool.js';
import { flaresolverrGet, isFlareSolverrEnabled } from './clients/flaresolverr.client.js';
import { htmlToMarkdown } from './clients/html-cleaner.js';
import { extractWithLLM } from './clients/llm.client.js';
import { getCachedEngine, setCachedEngine, invalidateCachedEngine } from '../utils/domain-engine-cache.js';

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

function isBlockedResponse(html, status, finalUrl = '') {
  if (!html || html.length < 150) return true;
  if ([403, 429, 503].includes(status)) return true;

  const lower = html.slice(0, 8000).toLowerCase();

  if (detectChallenge({ pageText: lower, status, url: finalUrl })) return true;

  if (html.length < 5000 && COOKIE_WALL_SIGNALS.some(s => lower.includes(s))) return true;

  return false;
}

// ─── Fetch Engines ──────────────────────────────────────────────

async function fetchWithHttp(url) {
  const response = await undiciFetch(url, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  const html = await response.text();

  return {
    html,
    status: response.status,
    finalUrl: response.url || url,
    engine: 'fetch',
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

async function dismissLoginModal(page) {
  try {
    const modal = page.locator('[role="dialog"]').first();
    if (!await modal.isVisible({ timeout: 1000 })) return false;

    const closeBtn = page.locator('[aria-label="Close"], [aria-label="Cerrar"]').first();
    if (await closeBtn.isVisible({ timeout: 500 })) {
      await closeBtn.click({ timeout: 2000 });
      await page.waitForTimeout(500);
      return true;
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return true;
  } catch { return false; }
}

async function fetchWithPlaywright(url, options = {}) {
  const browser = await getBrowser();
  const totalTimeout = options.timeout || 25000;
  const deadline = Date.now() + totalTimeout;
  const remaining = () => Math.max(deadline - Date.now(), 1000);

  const contextOptions = {
    locale: 'es-CO',
    viewport: { width: 1366, height: 768 },
    userAgent: buildUserAgent(),
  };

  if (options.proxy) {
    const proxyConfig = getPlaywrightProxyConfig();
    if (proxyConfig) contextOptions.proxy = proxyConfig;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  await context.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) return route.abort();
    return route.continue();
  });

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(totalTimeout - 2000, 5000),
    });

    await dismissCookieModal(page);
    await dismissLoginModal(page);

    // Wait for custom selector or content elements (cheap DOM count, not innerText)
    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: Math.min(8000, remaining()) }).catch(() => {});
    } else {
      await page.waitForFunction(
        () => {
          if (!document.body) return false;
          return document.body.querySelectorAll('p, li, td, h1, h2, h3, article, section, main').length > 20;
        },
        { timeout: Math.min(10000, remaining()) }
      ).catch(() => {});
    }

    // SPA content detection: wait for product/price indicators
    if (remaining() > 3000) {
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText || '';
          if (text.length > 5000) return true;
          const indicators = [
            '[data-product]', '[data-price]',
            '[class*="price"]', '[class*="precio"]',
            '.product__item', '.plp-mastercard',
            '[class*="product-card"]', '[class*="product-item"]',
            '[class*="product"] [class*="price"]',
          ];
          return indicators.some(s => document.querySelectorAll(s).length > 2);
        },
        { timeout: Math.min(8000, remaining()) }
      ).catch(() => {});
    }

    if (options.waitForScript && remaining() > 1500) {
      await page.waitForFunction(
        () => {
          const html = document.documentElement.outerHTML;
          return /("itemList"|__NEXT_DATA__|"@context")/.test(html);
        },
        { timeout: Math.min(5000, remaining()) }
      ).catch(() => {});
    }

    // Wait for prices to render before capturing content
    if (remaining() > 2000) {
      await page.waitForFunction(
        () => {
          const priceEls = document.querySelectorAll(
            '[class*="price"], [data-price], [class*="precio"]'
          );
          if (priceEls.length === 0) return true;
          return [...priceEls].some(el => /\d/.test(el.textContent));
        },
        { timeout: Math.min(5000, remaining()) }
      ).catch(() => {});
    }

    // Auto-scroll for infinite scroll pages (Facebook, etc.)
    if (options.scroll > 0 && remaining() > 3000) {
      const scrollCount = Math.min(options.scroll, 10);
      let prevHeight = 0;

      for (let i = 0; i < scrollCount; i++) {
        if (remaining() < 3000) break;

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const delay = 2000 + Math.floor(Math.random() * 2000);
        await page.waitForTimeout(delay);

        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === prevHeight) break;
        prevHeight = newHeight;
      }

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
    }

    const html = await page.content();

    if (html.length < 3000 && remaining() > 3000) {
      const dismissed = await dismissCookieModal(page);
      if (dismissed) {
        await page.waitForFunction(
          () => {
            if (!document.body) return false;
            return document.body.querySelectorAll('p, li, td, h1, h2, h3').length > 5;
          },
          { timeout: Math.min(8000, remaining()) }
        ).catch(() => {});
      }
    }

    const finalHtml = await page.content();
    const usedProxy = Boolean(options.proxy && contextOptions.proxy);

    return {
      html: finalHtml,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      engine: usedProxy ? 'playwright+proxy' : 'playwright',
    };
  } finally {
    try { await page?.close({ runBeforeUnload: false }); } catch { /* no-op */ }
    try { await context?.close(); } catch { /* no-op */ }
  }
}

async function fetchWithFlaresolverr(url, useProxy = false) {
  const flareData = await flaresolverrGet(url, useProxy);
  const solution = flareData?.solution || {};

  return {
    html: String(solution.response || ''),
    status: Number(solution.status) || null,
    finalUrl: String(solution.url || url),
    engine: 'flaresolverr',
  };
}

function isFlaresolverrResult(result) {
  if (!result?.html) return false;
  return !detectChallenge({
    pageText: result.html.slice(0, 8000).toLowerCase(),
    status: result.status,
  });
}

async function fetchWithCachedEngine(url, cached, options) {
  const { proxy, waitFor, timeout } = options;
  const useProxy = cached.needsProxy || proxy;

  switch (cached.engine) {
    case 'fetch': {
      if (options.render) return null;
      const result = await fetchWithHttp(url);
      return isBlockedResponse(result.html, result.status, result.finalUrl) ? null : result;
    }
    case 'playwright': {
      const result = await fetchWithPlaywright(url, { waitFor, timeout, proxy: useProxy });
      return isBlockedResponse(result.html, result.status, result.finalUrl) ? null : result;
    }
    case 'flaresolverr': {
      if (!isFlareSolverrEnabled()) return null;
      const result = await fetchWithFlaresolverr(url, useProxy);
      return isFlaresolverrResult(result) ? result : null;
    }
    default:
      return null;
  }
}

async function fetchWithCascade(url, options = {}) {
  const { render = false, proxy = false, waitFor, timeout, waitForScript, scroll } = options;

  // ─── Check domain cache ─────────────────────────────
  const cached = getCachedEngine(url);

  if (cached) {
    try {
      const result = await fetchWithCachedEngine(url, cached, options);
      if (result) {
        setCachedEngine(url, cached.engine, cached.needsProxy);
        result.engineCached = true;
        return result;
      }
    } catch { /* cached engine failed */ }

    invalidateCachedEngine(url);
  }

  // ─── Full cascade (first visit or cache invalidated) ─
  let httpResult = null;

  if (!render) {
    try {
      httpResult = await fetchWithHttp(url);
      if (!isBlockedResponse(httpResult.html, httpResult.status, httpResult.finalUrl)) {
        setCachedEngine(url, 'fetch', false);
        return httpResult;
      }
    } catch {
      // fetch failed — fall through
    }
  }

  // If HTTP fetch detected a JS challenge (Cloudflare), skip Playwright → go to FlareSolverr
  const isJsChallenge = httpResult && detectChallenge({
    pageText: (httpResult.html || '').slice(0, 8000).toLowerCase(),
    status: httpResult.status,
    url: httpResult.finalUrl,
  });

  if (isJsChallenge && isFlareSolverrEnabled()) {
    try {
      const result = await fetchWithFlaresolverr(url, proxy);
      if (isFlaresolverrResult(result)) {
        setCachedEngine(url, 'flaresolverr', proxy);
        return result;
      }
    } catch {
      // FlareSolverr failed — fall through to Playwright as last resort
    }
  }

  // Playwright
  try {
    const result = await fetchWithPlaywright(url, { waitFor, timeout, proxy, waitForScript, scroll });
    if (!isBlockedResponse(result.html, result.status, result.finalUrl)) {
      setCachedEngine(url, 'playwright', proxy);
      return result;
    }
  } catch {
    // Playwright failed — fall through to FlareSolverr
  }

  // FlareSolverr as final fallback (only if not already tried above)
  if (!isJsChallenge && isFlareSolverrEnabled()) {
    try {
      const result = await fetchWithFlaresolverr(url, proxy);
      if (isFlaresolverrResult(result)) {
        setCachedEngine(url, 'flaresolverr', proxy);
        return result;
      }
    } catch {
      // FlareSolverr failed
    }
  }

  throw new AppError(
    'All fetch engines failed for this URL',
    502,
    'FETCH_ALL_ENGINES_FAILED',
    { url }
  );
}

// ─── Pagination Helpers ─────────────────────────────────────────

const NEXT_PAGE_SELECTORS = [
  'a[rel="next"]',
  'link[rel="next"]',
  'a[title*="Siguiente" i]',
  'a[title*="Next" i]',
  'a[aria-label*="next" i]',
  'a[aria-label*="siguiente" i]',
  'li.andes-pagination__button--next a',
  '.pagination a.next',
  '.pagination li.next a',
  'a.pagination__next',
  '[data-testid*="next"] a',
  '[data-testid*="pagination-next"]',
  'a[class*="next-page" i]',
  'a[class*="nextpage" i]',
];

function isSameOrigin(href, baseUrl) {
  try {
    return new URL(href).origin === new URL(baseUrl).origin;
  } catch { return false; }
}

function extractNextPageUrl(html, baseUrl) {
  try {
    const $ = loadHtml(html);
    for (const selector of NEXT_PAGE_SELECTORS) {
      const el = $(selector).first();
      if (!el.length) continue;
      const href = el.attr('href');
      if (!href || href === '#') continue;
      try {
        return new URL(href, baseUrl).toString();
      } catch { continue; }
    }
  } catch { /* malformed HTML */ }
  return null;
}

function buildPageParamUrl(baseUrl, pageParam, pageNumber) {
  const url = new URL(baseUrl);
  url.searchParams.set(pageParam, String(pageNumber));
  return url.toString();
}

function mergeJsonResults(results) {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  if (results.every(r => Array.isArray(r))) {
    const seen = new Set();
    return results.flat().filter(item => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const first = results[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const arrayKeys = Object.keys(first).filter(k => Array.isArray(first[k]));
    if (arrayKeys.length === 1) {
      const key = arrayKeys[0];
      const seen = new Set();
      const merged = { ...first };
      merged[key] = results.flatMap(r => r[key] || []).filter(item => {
        const k = JSON.stringify(item);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return merged;
    }
  }

  return results;
}

// ─── Public API ─────────────────────────────────────────────────

export async function universalScrape({ url, prompt, model, schema, options = {} }, onProgress) {
  const start = Date.now();
  const formats = options.formats || (prompt ? ['json'] : ['markdown']);
  const wantsJson = formats.includes('json');
  const wantsMarkdown = formats.includes('markdown');
  const maxPages = options.maxPages || 1;
  const pageParam = options.pageParam || null;

  const allMarkdowns = [];
  const allJsonResults = [];
  const pagesMeta = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let llmModel = null;
  let totalChunks = 0;
  let firstTitle = '';

  let currentUrl = url;

  for (let page = 1; page <= maxPages; page++) {
    onProgress?.({ phase: 'scraping', page, url: currentUrl });

    let fetchResult;
    try {
      fetchResult = await runWithScraperLimiter(
        () => fetchWithCascade(currentUrl, options),
        'universal-scrape'
      );
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    onProgress?.({ phase: 'scraped', page, engine: fetchResult.engine, url: fetchResult.finalUrl });

    const cleaned = htmlToMarkdown(fetchResult.html, fetchResult.finalUrl);

    if (page === 1) firstTitle = cleaned.title;

    if (cleaned.length < 200 && page > 1) break;

    pagesMeta.push({
      page,
      url: fetchResult.finalUrl,
      engine: fetchResult.engine,
      engineCached: fetchResult.engineCached || false,
      statusCode: fetchResult.status,
      contentLength: cleaned.length,
    });

    if (wantsMarkdown) allMarkdowns.push(cleaned.markdown);

    if (wantsJson && prompt) {
      let markdownForLLM;
      if (cleaned.structuredData) {
        const itemCount = (cleaned.structuredData.match(/"title"|"name"|"nombre"/gi) || []).length;
        const contextLimit = itemCount > 5 ? 8_000 : 30_000;
        const fit = cleaned.fitMarkdown || '';
        const abbreviated = fit.length > cleaned.markdown.length * 0.4 ? fit : cleaned.markdown;
        markdownForLLM = abbreviated.length > contextLimit
          ? `${cleaned.structuredData}\n\n---\n\nPage context (abbreviated):\n${abbreviated.slice(0, contextLimit)}`
          : `${cleaned.structuredData}\n\n---\n\n${abbreviated}`;
      } else {
        const fit = cleaned.fitMarkdown || '';
        markdownForLLM = fit.length > cleaned.markdown.length * 0.4
          ? fit
          : cleaned.markdown;
      }
      onProgress?.({ phase: 'extracting', page });
      const { data, tokensUsed } = await extractWithLLM(markdownForLLM, prompt, schema, model);
      allJsonResults.push(data);
      totalTokensIn += tokensUsed.input;
      totalTokensOut += tokensUsed.output;
      llmModel = tokensUsed.model;
      if (tokensUsed.chunks) totalChunks += tokensUsed.chunks;

      const isEmpty = !data ||
        (Array.isArray(data) && data.length === 0) ||
        (typeof data === 'object' && !Array.isArray(data) &&
          Object.values(data).every(v => !v || (Array.isArray(v) && v.length === 0)));
      if (isEmpty && page > 1) break;
    }

    // Detect next page URL (only if more pages to scrape)
    if (page < maxPages) {
      const nextUrl = extractNextPageUrl(fetchResult.html, fetchResult.finalUrl);
      if (nextUrl && isSameOrigin(nextUrl, url)) {
        currentUrl = nextUrl;
        onProgress?.({ phase: 'pagination', page: page + 1, url: currentUrl });
      } else if (pageParam) {
        currentUrl = buildPageParamUrl(url, pageParam, page + 1);
        onProgress?.({ phase: 'pagination', page: page + 1, url: currentUrl });
      } else {
        break;
      }
    }
  }

  const firstMeta = pagesMeta[0] || {};
  const result = {
    metadata: {
      url: firstMeta.url || url,
      title: firstTitle,
      statusCode: firstMeta.statusCode || null,
      engine: firstMeta.engine || null,
      engineCached: firstMeta.engineCached || false,
      contentLength: pagesMeta.reduce((s, p) => s + p.contentLength, 0),
      elapsed: Date.now() - start,
      pagesScraped: pagesMeta.length,
    },
  };

  if (pagesMeta.length > 1) {
    result.metadata.pages = pagesMeta;
  }

  if (wantsMarkdown) {
    result.markdown = allMarkdowns.length === 1
      ? allMarkdowns[0]
      : allMarkdowns.join('\n\n---\n\n');
  }

  if (wantsJson && prompt) {
    result.json = allJsonResults.length <= 1
      ? (allJsonResults[0] ?? null)
      : mergeJsonResults(allJsonResults);
    result.metadata.tokensUsed = totalTokensIn + totalTokensOut;
    result.metadata.llmModel = llmModel;
    if (totalChunks > 0) result.metadata.chunks = totalChunks;
  }

  result.metadata.elapsed = Date.now() - start;

  return result;
}
