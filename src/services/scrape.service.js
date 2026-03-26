import { scrapeDecathlon } from './scrapers/decathlon.scraper.js';
import { scrapeMercadoLibre } from './scrapers/mercadolibre.scraper.js';
import { normalizeProducts } from './normalizers/product.normalizer.js';
import { getScraperLimiterStats, runWithScraperLimiter } from '../utils/scraper-concurrency.js';

export async function runMercadoLibreSearch(input) {
  const raw = await runWithScraperLimiter(
    () => scrapeMercadoLibre(input),
    'mercadolibre'
  );
  const products = normalizeProducts(raw.products, 'mercadolibre');

  return {
    ok: true,
    site: 'mercadolibre',
    count: products.length,
    products,
    meta: {
      ...raw.meta,
      limiter: getScraperLimiterStats(),
    },
  };
}

export async function runDecathlonSearch(input) {
  const raw = await runWithScraperLimiter(
    () => scrapeDecathlon(input),
    'decathlon'
  );
  const products = normalizeProducts(raw.products, 'decathlon');

  return {
    ok: true,
    site: 'decathlon',
    count: products.length,
    products,
    meta: {
      ...raw.meta,
      limiter: getScraperLimiterStats(),
    },
  };
}
