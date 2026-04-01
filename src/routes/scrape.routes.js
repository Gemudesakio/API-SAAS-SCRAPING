import { Router } from 'express';
import {
  scrapeDecathlonController,
  scrapeMercadoLibreController,
  scrapePepeGangaController,
  scrapeFalabellaController,
  scrapeExitoController,
  scrapeHomecenterController,
} from '../controllers/scrape.controller.js';
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

router.post(
  '/pepeganga/search',
  validateBody(scrapeRequestSchema),
  scrapePepeGangaController
);

router.post(
  '/falabella/search',
  validateBody(scrapeRequestSchema),
  scrapeFalabellaController
);

router.post(
  '/exito/search',
  validateBody(scrapeRequestSchema),
  scrapeExitoController
);

router.post(
  '/homecenter/search',
  validateBody(scrapeRequestSchema),
  scrapeHomecenterController
);

export default router;