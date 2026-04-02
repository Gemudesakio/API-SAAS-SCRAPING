import { createCompeId } from '../../utils/id.js';
import { cleanPriceToInt } from '../../utils/scraper.helpers.js';
import { PROVIDER_BY_SITE } from '../../constants/providers.js';

function mapStock(raw = '') {
  const value = String(raw).toLowerCase();
  if (value.includes('agot') || value.includes('outofstock') || value.includes('sin stock')) {
    return 'AGOTADO';
  }
  if (
    value.includes('no puede enviarse') ||
    value.includes('cannot be shipped') ||
    value.includes('currently unavailable') ||
    value.includes('no disponible para enviar')
  ) {
    return 'AGOTADO';
  }
  return 'DISPONIBLE';
}

export function normalizeProducts(rawProducts, site) {
  return rawProducts.map((product) => ({
    COMPE_ID: createCompeId(site, product.url, product.title),
    NOMBRE: product.title || '',
    PRECIO: cleanPriceToInt(product.priceRaw),
    STOCK: mapStock(product.availabilityRaw),
    availability_raw: product.availabilityRaw || '',
    URL: product.url || '',
    IMAGEN: product.image || '',
    PROVEEDOR: PROVIDER_BY_SITE[site] || site,
  }));
}
