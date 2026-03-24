import { notFound } from '../errors/http-errors.js';

export default function notFoundHandler(req, res, next) {
  return next(
    notFound('Route not found', {
      path: req.originalUrl,
      method: req.method,
    })
  );
}