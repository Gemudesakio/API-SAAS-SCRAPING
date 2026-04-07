import { z } from 'zod';

export const extractRequestSchema = z.object({
  url: z.string().url('url must be a valid URL'),
  prompt: z.string().trim().min(5, 'prompt must be at least 5 characters').optional(),
  model: z.string().trim().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  options: z
    .object({
      render: z.boolean().default(false),
      proxy: z.boolean().default(false),
      waitFor: z.string().optional(),
      timeout: z.coerce.number().int().min(5000).max(120000).default(30000),
      formats: z
        .array(z.enum(['json', 'markdown']))
        .min(1)
        .default(['json']),
      maxPages: z.coerce.number().int().min(1).max(5).default(1),
      pageParam: z.string().trim().min(1).max(50).optional(),
    })
    .default({}),
});
