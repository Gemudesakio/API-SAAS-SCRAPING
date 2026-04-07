import { z } from 'zod';

export const scrapeAllRequestSchema = z.object({
  query: z.string().trim().min(2, 'query debe tener al menos 2 caracteres'),
  maxItems: z.coerce.number().int().min(1).max(100).default(20),
  maxPages: z.coerce.number().int().min(1).max(10).default(3),
});
