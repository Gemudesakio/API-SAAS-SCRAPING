import { Router } from 'express';
import {
  scrapeDecathlonController,
  scrapeMercadoLibreController,
  scrapePepeGangaController,
  scrapeFalabellaController,
  scrapeExitoController,
  scrapeHomecenterController,
  scrapeAmazonController,
  scrapeEbayController,
  scrapeAliExpressController,
  scrapeFacebookController,
} from '../controllers/scrape.controller.js';
import { scrapeAllController } from '../controllers/scrape-all.controller.js';
import { extractController, modelsController } from '../controllers/extract.controller.js';
import validateBody from '../middlewares/validate_body.js';
import { scrapeRequestSchema } from '../validators/scrape.validator.js';
import { scrapeAllRequestSchema } from '../validators/scrape-all.validator.js';
import { extractRequestSchema } from '../validators/extract.validator.js';
import { facebookRequestSchema } from '../validators/facebook.validator.js';

const router = Router();

router.get('/extract/models', modelsController);

router.post(
  '/extract',
  validateBody(extractRequestSchema),
  extractController
);

router.post(
  '/all/search',
  validateBody(scrapeAllRequestSchema),
  scrapeAllController
);

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

router.post(
  '/amazon/search',
  validateBody(scrapeRequestSchema),
  scrapeAmazonController
);

router.post(
  '/ebay/search',
  validateBody(scrapeRequestSchema),
  scrapeEbayController
);

router.post(
  '/aliexpress/search',
  validateBody(scrapeRequestSchema),
  scrapeAliExpressController
);

router.post(
  '/facebook/posts',
  validateBody(facebookRequestSchema),
  scrapeFacebookController
);

export default router;