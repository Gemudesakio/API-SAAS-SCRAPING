import crypto from 'node:crypto';

function normalizeToken(value = '') {
  return String(value)
    .trim()
    .replace(/[)\].,;:!?]+$/g, '')
    .toUpperCase();
}

function extractParamsFromHash(hash = '') {
  const raw = String(hash || '').replace(/^#/, '').trim();
  if (!raw || !raw.includes('=')) return new URLSearchParams();
  return new URLSearchParams(raw);
}

function buildCanonicalUrl(inputUrl = '') {
  try {
    const parsed = new URL(inputUrl);
    const filteredParams = new URLSearchParams();
    const trackingParams = new Set([
      'tracking_id',
      'position',
      'type',
      'sid',
      'search_layout',
      'polycard_client',
      'layout',
      'c_id',
      'rid',
      'source',
      'zip',
      'zap',
      'rank',
      'event_id',
    ]);

    const entries = Array.from(parsed.searchParams.entries())
      .filter(([key]) => !trackingParams.has(String(key).toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of entries) {
      filteredParams.append(key, value);
    }

    parsed.hash = '';
    parsed.search = filteredParams.toString();

    return parsed.toString();
  } catch {
    return String(inputUrl || '').trim();
  }
}

function getMercadoLibreStableProductKey(url = '', name = '') {
  const fallbackName = String(name || '').trim().toLowerCase();

  try {
    const parsed = new URL(url);
    const mergedParams = new URLSearchParams(parsed.search);
    const hashParams = extractParamsFromHash(parsed.hash);

    for (const [key, value] of hashParams.entries()) {
      if (!mergedParams.has(key)) mergedParams.set(key, value);
    }

    const wid = normalizeToken(mergedParams.get('wid'));
    if (wid) return `wid:${wid}`;

    const itemIdParam = normalizeToken(mergedParams.get('item_id'));
    if (itemIdParam) return `item:${itemIdParam}`;

    const pathIdMatch = parsed.pathname.match(/\/(?:p|up)\/([^/?#]+)/i);
    if (pathIdMatch?.[1]) {
      return `path:${normalizeToken(pathIdMatch[1])}`;
    }

    const canonicalUrl = buildCanonicalUrl(url);
    if (canonicalUrl) return `url:${canonicalUrl}`;
  } catch {
    // no-op: cae a fallback
  }

  if (fallbackName) return `name:${fallbackName}`;
  return String(url || '').trim();
}

function getStableProductKey(site = '', url = '', name = '') {
  const normalizedSite = String(site || '').trim().toLowerCase();

  if (normalizedSite === 'mercadolibre') {
    return getMercadoLibreStableProductKey(url, name);
  }

  const canonicalUrl = buildCanonicalUrl(url);
  if (canonicalUrl) return canonicalUrl;

  return String(name || '').trim().toLowerCase();
}

export function createCompeId(site, url, name) {
  const stableProductKey = getStableProductKey(site, url, name);
  const seed = `${site}|${stableProductKey}`;
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8);

  return `cp_${hash}`;
}
