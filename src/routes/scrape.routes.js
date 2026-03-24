import { Router } from 'express';
import { scrapeDecathlonController, scrapeMercadoLibreController } from '../controllers/scrape.controller.js';
import validateBody from '../middlewares/validate_body.js';
import { scrapeRequestSchema } from '../validators/scrape.validator.js';

const router = Router();

router.post(
  '/mercadolibre/search',
  validateBody(scrapeRequestSchema),
  scrapeMercadoLibreController
);

router.post(
  '/decathlon/search',
  validateBody(scrapeRequestSchema),
  scrapeDecathlonController
);

export default router;