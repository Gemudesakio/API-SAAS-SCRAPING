import { scrapeDecathlon } from './scrapers/decathlon.scraper.js';
import { scrapeMercadoLibre } from './scrapers/mercadolibre.scraper.js';
import { scrapePepeGanga } from './scrapers/pepeganga.scraper.js';
import { scrapeFalabella } from './scrapers/falabella.scraper.js';
import { scrapeExito } from './scrapers/exito.scraper.js';
import { scrapeHomecenter } from './scrapers/homecenter.scraper.js';
import { normalizeProducts } from './normalizers/product.normalizer.js';
import { getScraperLimiterStats, runWithScraperLimiter } from '../utils/scraper-concurrency.js';

function buildResponse(raw, site) {
  const products = normalizeProducts(raw.products, site);
  return {
    ok: true,
    site,
    count: products.length,
    products,
    meta: {
      ...raw.meta,
      limiter: getScraperLimiterStats(),
    },
  };
}

export async function runMercadoLibreSearch(input) {
  const raw = await runWithScraperLimiter(() => scrapeMercadoLibre(input), 'mercadolibre');
  return buildResponse(raw, 'mercadolibre');
}

export async function runDecathlonSearch(input) {
  const raw = await runWithScraperLimiter(() => scrapeDecathlon(input), 'decathlon');
  return buildResponse(raw, 'decathlon');
}

export async function runPepeGangaSearch(input) {
  const raw = await runWithScraperLimiter(() => scrapePepeGanga(input), 'pepeganga');
  return buildResponse(raw, 'pepeganga');
}

export async function runFalabellaSearch(input) {
  const raw = await runWithScraperLimiter(() => scrapeFalabella(input), 'falabella');
  return buildResponse(raw, 'falabella');
}

export async function runExitoSearch(input) {
  const raw = await runWithScraperLimiter(() => scrapeExito(input), 'exito');
  return buildResponse(raw, 'exito');
}

export async function runHomecenterSearch(input) {
  const raw = await runWithScraperLimiter(() => scrapeHomecenter(input), 'homecenter');
  return buildResponse(raw, 'homecenter');
}
