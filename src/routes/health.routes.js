import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'api-scraping',
    timestamp: new Date().toISOString(),
  });
});

export default router;
