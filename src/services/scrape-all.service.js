import {
  runPepeGangaSearch,
  runExitoSearch,
  runFalabellaSearch,
  runHomecenterSearch,
  runAmazonSearch,
  runMercadoLibreSearch,
  runDecathlonSearch,
  runEbaySearch,
  runAliExpressSearch,
} from './scrape.service.js';
import { ERROR_CODES } from '../errors/error-codes.js';

const SCRAPE_ALL_TIMEOUT_MS = Number(process.env.SCRAPE_ALL_TIMEOUT_MS) || 90_000;

const SCRAPERS = [
  { site: 'pepeganga', runner: runPepeGangaSearch },
  { site: 'exito', runner: runExitoSearch },
  { site: 'falabella', runner: runFalabellaSearch },
  { site: 'homecenter', runner: runHomecenterSearch },
  { site: 'amazon', runner: runAmazonSearch },
  { site: 'mercadolibre', runner: runMercadoLibreSearch },
  { site: 'decathlon', runner: runDecathlonSearch },
  { site: 'ebay', runner: runEbaySearch },
  { site: 'aliexpress', runner: runAliExpressSearch },
];

function withTimeout(promise, ms, site) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${site} exceeded ${ms}ms timeout`)), ms)
    ),
  ]);
}

export function getSiteList() {
  return SCRAPERS.map(s => s.site);
}

export async function runAllScrapersSearch(input, onSiteComplete) {
  const start = Date.now();
  let succeeded = 0;
  let failed = 0;
  let totalProducts = 0;

  const promises = SCRAPERS.map(({ site, runner }) => {
    const siteStart = Date.now();

    return withTimeout(runner(input), SCRAPE_ALL_TIMEOUT_MS, site)
      .then(result => {
        succeeded++;
        totalProducts += result.count;
        onSiteComplete({
          type: 'site-result',
          site,
          ok: true,
          count: result.count,
          products: result.products,
          meta: result.meta,
          elapsed: Date.now() - siteStart,
        });
      })
      .catch(err => {
        failed++;
        const isTimeout = err.message?.includes('timeout');
        onSiteComplete({
          type: 'site-error',
          site,
          ok: false,
          error: err.message || 'Unknown error',
          code: isTimeout ? ERROR_CODES.SCRAPE_ALL_TIMEOUT : (err.code || ERROR_CODES.INTERNAL_ERROR),
          elapsed: Date.now() - siteStart,
        });
      });
  });

  await Promise.all(promises);

  return {
    total: SCRAPERS.length,
    succeeded,
    failed,
    totalProducts,
    elapsed: Date.now() - start,
  };
}
