import { z } from 'zod';

const booleanFromAny = z.preprocess((value) => {
  if (value === undefined) return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  return Boolean(value);
}, z.boolean());

export const scrapeRequestSchema = z
  .object({
    query: z.string().trim().min(2, 'query debe tener al menos 2 caracteres').optional(),
    url: z.string().url('Debe ser una URL válida').optional(),
    maxItems: z.coerce.number().int().min(1).max(100).default(20),
    headless: booleanFromAny.default(true),
  })
  .refine(
    (data) => data.query || data.url,
    {
      message: 'Debe proporcionar al menos "query" o "url"',
      path: ['query'], // Puedes elegir cualquier campo para mostrar el error
    }
  );