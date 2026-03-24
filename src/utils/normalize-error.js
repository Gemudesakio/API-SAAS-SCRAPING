import { AppError } from '../errors/app-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';
import { internalError } from '../errors/http-errors.js';

export function normalizeError(err) {
  if (err instanceof AppError) {
    return err;
  }

  // JSON inválido enviado al body parser
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return new AppError(
      'Invalid JSON body',
      400,
      ERROR_CODES.INVALID_JSON
    );
  }

  // Payload muy grande
  if (err?.type === 'entity.too.large') {
    return new AppError(
      'Payload too large',
      413,
      ERROR_CODES.PAYLOAD_TOO_LARGE
    );
  }

  // Error genérico nativo
  if (err instanceof Error) {
    return internalError(err.message);
  }

  // Caso raro: lanzaron un string
  if (typeof err === 'string') {
    return internalError(err);
  }

  // Fallback total
  return internalError();
}