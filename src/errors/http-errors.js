import { AppError } from './app-error.js';
import { ERROR_CODES } from './error-codes.js';

export const badRequest = (
  message = 'Bad request',
  code = ERROR_CODES.VALIDATION_ERROR,
  details = null
) => new AppError(message, 400, code, details);

export const unauthorized = (
  message = 'Unauthorized',
  details = null
) => new AppError(message, 401, ERROR_CODES.UNAUTHORIZED, details);

export const forbidden = (
  message = 'Forbidden',
  details = null
) => new AppError(message, 403, ERROR_CODES.FORBIDDEN, details);

export const notFound = (
  message = 'Resource not found',
  details = null
) => new AppError(message, 404, ERROR_CODES.ROUTE_NOT_FOUND, details);

export const conflict = (
  message = 'Conflict',
  details = null
) => new AppError(message, 409, ERROR_CODES.CONFLICT, details);

export const tooManyRequests = (
  message = 'Too many requests',
  details = null
) => new AppError(message, 429, ERROR_CODES.TOO_MANY_REQUESTS, details);

export const internalError = (
  message = 'Internal server error',
  details = null
) => new AppError(message, 500, ERROR_CODES.INTERNAL_ERROR, details);

export const serviceUnavailable = (
  message = 'Service unavailable',
  code = ERROR_CODES.INTERNAL_ERROR,
  details = null
) => new AppError(message, 503, code, details);

export const gatewayTimeout = (
  message = 'Gateway timeout',
  code = ERROR_CODES.SCRAPER_TIMEOUT,
  details = null
) => new AppError(message, 504, code, details);