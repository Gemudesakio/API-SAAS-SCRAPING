import { AppError } from '../../errors/app-error.js';
import { randomUUID } from 'node:crypto';

let cachedSessionId = null;
let cachedSessionExpiresAt = 0;
let createSessionPromise = null;

function parseIntEnv(value, fallback, min = 0, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  const normalized = Math.trunc(parsed);

  if (normalized < min) return fallback;
  if (normalized > max) return max;

  return normalized;
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  return fallback;
}

function getConfig() {
  return {
    url: (process.env.FLARESOLVERR_URL || '').trim(),
    proxyUrl: (process.env.PROXY_URL || '').trim(),
    requestTimeoutMs: parseIntEnv(process.env.FLARESOLVERR_REQUEST_TIMEOUT_MS, 130000, 1000, 600000),
    maxTimeoutMs: parseIntEnv(process.env.FLARESOLVERR_TIMEOUT_MS, 120000, 1000, 600000),
    waitInSeconds: parseIntEnv(process.env.FLARESOLVERR_WAIT_SECONDS, 3, 0, 60),
    disableMedia: parseBooleanEnv(process.env.FLARESOLVERR_DISABLE_MEDIA, true),
    useSession: parseBooleanEnv(process.env.FLARESOLVERR_USE_SESSION, true),
    sessionTtlMinutes: parseIntEnv(process.env.FLARESOLVERR_SESSION_TTL_MINUTES, 15, 1, 240),
  };
}

export function isFlareSolverrEnabled() {
  return Boolean(getConfig().url);
}

async function postFlareSolverr(payload) {
  const config = getConfig();

  if (!config.url) {
    throw new AppError(
      'FLARESOLVERR_URL no está configurado',
      500,
      'SCRAPER_NAVIGATION_ERROR'
    );
  }

  let response;

  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    throw new AppError(
      'No se pudo conectar con FlareSolverr',
      503,
      'SCRAPER_NAVIGATION_ERROR',
      {
        reason: 'connection_error',
        flaresolverrUrl: config.url,
        message: error?.message || 'unknown error',
      }
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new AppError(
      'FlareSolverr devolvió una respuesta no válida',
      503,
      'SCRAPER_NAVIGATION_ERROR',
      {
        reason: 'invalid_json',
        status: response.status,
      }
    );
  }

  if (!response.ok) {
    throw new AppError(
      'FlareSolverr devolvió un error HTTP',
      503,
      'SCRAPER_NAVIGATION_ERROR',
      {
        reason: 'upstream_http_error',
        status: response.status,
        upstreamStatus: data?.status || null,
        upstreamMessage: data?.message || null,
      }
    );
  }

  if (data?.status !== 'ok') {
    throw new AppError(
      'FlareSolverr no pudo resolver la solicitud',
      503,
      'SCRAPER_NAVIGATION_ERROR',
      {
        reason: 'upstream_not_ok',
        upstreamStatus: data?.status || null,
        upstreamMessage: data?.message || null,
      }
    );
  }

  return data;
}

function isSessionExpired(config) {
  return !cachedSessionId || Date.now() >= cachedSessionExpiresAt - 5000;
}

function resetSessionCache() {
  cachedSessionId = null;
  cachedSessionExpiresAt = 0;
}

async function ensureSession(config, { forceRefresh = false } = {}) {
  if (!config.useSession) return null;

  if (forceRefresh) {
    resetSessionCache();
  }

  if (!isSessionExpired(config)) {
    return cachedSessionId;
  }

  if (createSessionPromise) {
    return createSessionPromise;
  }

  createSessionPromise = (async () => {
    const sessionId = `fs_${randomUUID()}`;

    await postFlareSolverr({
      cmd: 'sessions.create',
      session: sessionId,
    });

    cachedSessionId = sessionId;
    cachedSessionExpiresAt = Date.now() + (config.sessionTtlMinutes * 60 * 1000);

    return cachedSessionId;
  })().finally(() => {
    createSessionPromise = null;
  });

  return createSessionPromise;
}

function isSessionError(error) {
  const detailsMessage = error?.details?.upstreamMessage || '';
  const haystack = `${error?.message || ''} ${detailsMessage}`.toLowerCase();

  if (!haystack.includes('session')) return false;

  return (
    haystack.includes('not found') ||
    haystack.includes('does not exist') ||
    haystack.includes('invalid')
  );
}

function buildGetPayload({ url, config, session, useProxy = false }) {
  const payload = {
    cmd: 'request.get',
    url,
    maxTimeout: config.maxTimeoutMs,
    waitInSeconds: config.waitInSeconds,
    disableMedia: config.disableMedia,
  };

  if (session) {
    payload.session = session;
    payload.session_ttl_minutes = config.sessionTtlMinutes;
  }

  if (useProxy && config.proxyUrl) {
    payload.proxy = { url: config.proxyUrl };
  }

  return payload;
}

export async function flaresolverrGet(url, useProxy = false) {
  const config = getConfig();

  let session = await ensureSession(config);

  try {
    return await postFlareSolverr(
      buildGetPayload({ url, config, session, useProxy })
    );
  } catch (error) {
    if (!session || !isSessionError(error)) {
      throw error;
    }

    session = await ensureSession(config, { forceRefresh: true });

    return postFlareSolverr(
      buildGetPayload({ url, config, session, useProxy })
    );
  }
}
