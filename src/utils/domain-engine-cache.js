const CACHE_TTL_MS = (Number(process.env.DOMAIN_CACHE_TTL_MINUTES) || 30) * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map();

export function getCachedEngine(url) {
  try {
    const hostname = new URL(url).hostname;
    const entry = cache.get(hostname);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      cache.delete(hostname);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function setCachedEngine(url, engine, needsProxy = false) {
  try {
    const hostname = new URL(url).hostname;
    const existing = cache.get(hostname);

    cache.delete(hostname);
    cache.set(hostname, {
      engine,
      needsProxy,
      cachedAt: Date.now(),
      hits: (existing?.engine === engine ? (existing.hits || 0) : 0) + 1,
    });

    if (cache.size > MAX_ENTRIES) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
  } catch { /* invalid URL, skip */ }
}

export function invalidateCachedEngine(url) {
  try {
    cache.delete(new URL(url).hostname);
  } catch { /* skip */ }
}

export function getCacheStats() {
  return {
    size: cache.size,
    maxEntries: MAX_ENTRIES,
    ttlMinutes: CACHE_TTL_MS / 60000,
    entries: [...cache.entries()].map(([host, e]) => ({
      host,
      engine: e.engine,
      needsProxy: e.needsProxy,
      hits: e.hits,
      ageSeconds: Math.round((Date.now() - e.cachedAt) / 1000),
    })),
  };
}
