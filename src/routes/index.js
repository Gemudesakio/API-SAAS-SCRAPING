import { Router } from 'express';
import healthRouter from './health.routes.js';
import scrapeRouter from './scrape.routes.js';
import docsRouter from './docs.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/scrape', scrapeRouter);
router.use('/docs', docsRouter);

export default router;
