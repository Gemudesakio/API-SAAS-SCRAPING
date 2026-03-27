import { AppError } from '../../errors/app-error.js';

function parseIntEnv(value, fallback, min = 0, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  const normalized = Math.trunc(parsed);

  if (normalized < min) return fallback;
  if (normalized > max) return max;

  return normalized;
}

function getConfig() {
  return {
    url: (process.env.FLARESOLVERR_URL || '').trim(),
    requestTimeoutMs: parseIntEnv(process.env.FLARESOLVERR_REQUEST_TIMEOUT_MS, 130000, 1000, 600000),
    maxTimeoutMs: parseIntEnv(process.env.FLARESOLVERR_TIMEOUT_MS, 120000, 1000, 600000),
    waitInSeconds: parseIntEnv(process.env.FLARESOLVERR_WAIT_SECONDS, 3, 0, 60),
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

export async function flaresolverrGet(url) {
  const config = getConfig();

  return postFlareSolverr({
    cmd: 'request.get',
    url,
    maxTimeout: config.maxTimeoutMs,
    waitInSeconds: config.waitInSeconds,
  });
}
