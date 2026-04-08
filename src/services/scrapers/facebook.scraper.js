import { getBrowser, getAuthStorageState, saveAuthStorageState } from '../clients/browser-pool.js';
import { buildUserAgent } from '../../utils/scraper.helpers.js';

const POST_SELECTOR = '[data-ad-comet-preview="message"]';
const DEFAULT_MAX_POSTS = 10;

export async function scrapeFacebook({ url, maxItems = DEFAULT_MAX_POSTS, timeout = 90000 }) {
  const browser = await getBrowser();
  const storageState = getAuthStorageState();

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: buildUserAgent(),
    locale: 'es-CO',
    ...(storageState && { storageState }),
  });
  const page = await context.newPage();
  const deadline = Date.now() + timeout - 5000;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Extract page info before scrolling
    const pageInfo = await page.evaluate(() => {
      const name = document.querySelector('h1')?.textContent?.trim() || '';
      const followersEl = [...document.querySelectorAll('a[href*="followers"]')];
      const followers = followersEl.map(el => el.textContent.trim()).find(t => /\d/.test(t)) || '';
      return { name, followers };
    });

    // Scroll-and-capture: extract posts at each scroll iteration
    const posts = new Map();

    const capture = async () => {
      const current = await page.evaluate((sel) => {
        return [...document.querySelectorAll(sel)]
          .map(el => el.textContent.trim())
          .filter(t => t.length > 20);
      }, POST_SELECTOR).catch(() => []);

      for (const text of current) {
        const key = text.slice(0, 80);
        if (!posts.has(key)) posts.set(key, text);
      }
    };

    await capture();

    while (posts.size < maxItems && Date.now() < deadline) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const delay = 1500 + Math.floor(Math.random() * 1500);
      await page.waitForTimeout(delay);
      await capture();
    }

    // Save refreshed cookies
    if (storageState) {
      try { saveAuthStorageState(await context.storageState()); } catch { /* no-op */ }
    }

    const postList = [...posts.values()].slice(0, maxItems);

    return {
      posts: postList.map((text, i) => ({
        index: i + 1,
        text,
      })),
      meta: {
        pageUrl: url,
        pageName: pageInfo.name,
        followers: pageInfo.followers,
        totalPosts: postList.length,
        authenticated: !!storageState,
      },
    };
  } finally {
    try { await page?.close({ runBeforeUnload: false }); } catch { /* no-op */ }
    try { await context?.close(); } catch { /* no-op */ }
  }
}
