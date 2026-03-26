import fs from 'node:fs/promises';
import path from 'node:path';

const DEBUG_ENABLED = process.env.SCRAPER_DEBUG === 'true';
const SAVE_HTML = process.env.SCRAPER_DEBUG_SAVE_HTML === 'true';
const DEBUG_DIR = process.env.SCRAPER_DEBUG_DIR || '/tmp/scraper-debug';

function buildDebugId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function collectPageDiagnostics(
  page,
  {
    site,
    status = null,
    reason = 'selector_not_found',
  } = {}
) {
  const pageUrl = page.url();
  const pageTitle = await page.title().catch(() => '');
  const pageText = await page.textContent('body').catch(() => '');
  const html = await page.content().catch(() => '');

  const diagnostics = {
    reason,
    site,
    status,
    pageUrl,
    pageTitle,
    bodyPreview: (pageText || '').slice(0, 2000),
    screenshotPath: null,
    htmlPath: null,
    debugEnabled: DEBUG_ENABLED,
  };

  if (!DEBUG_ENABLED) return diagnostics;

  const id = buildDebugId();
  const siteDir = path.join(DEBUG_DIR, site || 'unknown');
  await fs.mkdir(siteDir, { recursive: true });

  const screenshotPath = path.join(siteDir, `${id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  diagnostics.screenshotPath = screenshotPath;

  if (SAVE_HTML && html) {
    const htmlPath = path.join(siteDir, `${id}.html`);
    await fs.writeFile(htmlPath, html, 'utf8').catch(() => {});
    diagnostics.htmlPath = htmlPath;
  }

  return diagnostics;
}
