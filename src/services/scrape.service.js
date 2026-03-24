import { scrapeDecathlon } from './scrapers/decathlon.scraper.js';
import { scrapeMercadoLibre } from './scrapers/mercadolibre.scraper.js';
import { normalizeProducts } from './normalizers/product.normalizer.js';

export async function runMercadoLibreSearch(input) {
  const raw = await scrapeMercadoLibre(input);
  const products = normalizeProducts(raw.products, 'mercadolibre');

  return {
    ok: true,
    site: 'mercadolibre',
    count: products.length,
    products,
    meta: raw.meta,
  };
}

export async function runDecathlonSearch(input) {
  const raw = await scrapeDecathlon(input);
  const products = normalizeProducts(raw.products, 'decathlon');

  return {
    ok: true,
    site: 'decathlon',
    count: products.length,
    products,
    meta: raw.meta,
  };
}
