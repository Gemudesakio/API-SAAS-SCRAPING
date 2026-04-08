import { z } from 'zod';
import { isPublicUrl } from '../utils/url-validator.js';

export const facebookRequestSchema = z.object({
  url: z.string().url().refine(isPublicUrl, 'URL must be a public HTTP/HTTPS address')
    .refine(u => u.includes('facebook.com'), 'URL must be a Facebook page URL'),
  maxItems: z.coerce.number().int().min(1).max(50).default(10),
  timeout: z.coerce.number().int().min(10000).max(180000).default(90000),
});
