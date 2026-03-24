import { badRequest } from '../errors/http-errors.js';

function buildZodDetails(zodError) {
  return zodError.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export default function validateBody(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return next(
        badRequest(
          'Invalid input',
          'VALIDATION_ERROR',
          buildZodDetails(result.error)
        )
      );
    }

    req.validatedBody = result.data;
    return next();
  };
}