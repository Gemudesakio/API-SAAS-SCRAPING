import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../docs/openapi.js';

const router = Router();

router.get('/openapi.json', (req, res) => {
  return res.status(200).json(openApiDocument);
});

router.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    explorer: true,
    customSiteTitle: 'API SaaS Scraping Docs',
  })
);

export default router;
