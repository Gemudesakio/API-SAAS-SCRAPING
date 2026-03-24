import { normalizeError } from '../utils/normalize-error.js';

export default function errorHandler(err, req, res, next) {
  const normalized = normalizeError(err);

  console.error({
    message: normalized.message,
    code: normalized.code,
    status: normalized.status,
    path: req.originalUrl,
    method: req.method,
    details: normalized.details,
    stack: normalized.stack,
  });

  return res.status(normalized.status).json({
    ok: false,
    error: normalized.message,
    code: normalized.code,
    details: normalized.details || null,
  });
}