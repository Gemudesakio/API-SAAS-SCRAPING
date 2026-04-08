import { chromium } from 'playwright';

const MAX_REQUESTS_BEFORE_RECYCLE = Number(process.env.BROWSER_POOL_RECYCLE_AFTER) || 100;

const OPTIMIZED_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-gl-drawing-for-tests',
  '--disable-software-rasterizer',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-component-update',
  '--disable-sync',
  '--disable-translate',
  '--disable-default-apps',
  '--disable-client-side-phishing-detection',
  '--disable-breakpad',
  '--no-first-run',
  '--js-flags=--max-old-space-size=512',
];

let browserInstance = null;
let launchPromise = null;
let requestCount = 0;

async function launchBrowser(launchOptions = {}) {
  try {
    return await chromium.launch({
      channel: 'chrome',
      headless: launchOptions.headless ?? true,
      args: [...OPTIMIZED_ARGS, '--disable-blink-features=AutomationControlled'],
    });
  } catch {
    return chromium.launch({
      headless: launchOptions.headless ?? true,
      args: [...OPTIMIZED_ARGS, '--disable-blink-features=AutomationControlled'],
    });
  }
}

export async function getBrowser(launchOptions = {}) {
  if (requestCount >= MAX_REQUESTS_BEFORE_RECYCLE && browserInstance?.isConnected()) {
    await closeBrowser();
  }

  if (browserInstance?.isConnected()) {
    requestCount++;
    return browserInstance;
  }

  if (!launchPromise) {
    launchPromise = launchBrowser(launchOptions)
      .then((browser) => {
        browserInstance = browser;
        requestCount = 1;
        browser.on('disconnected', () => {
          browserInstance = null;
          launchPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        launchPromise = null;
        throw err;
      });
  }

  const browser = await launchPromise;
  launchPromise = null;
  return browser;
}

export async function closeBrowser() {
  const instance = browserInstance;
  browserInstance = null;
  launchPromise = null;
  requestCount = 0;

  if (instance?.isConnected()) {
    await instance.close().catch(() => {});
  }
}

export { OPTIMIZED_ARGS };
