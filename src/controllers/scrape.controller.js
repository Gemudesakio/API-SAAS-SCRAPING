import asyncHandler from '../middlewares/async_handler.js';
import { runDecathlonSearch, runMercadoLibreSearch } from '../services/scrape.service.js';

export const scrapeMercadoLibreController = asyncHandler(async (req, res) => {
  const payload = await runMercadoLibreSearch(req.validatedBody);

  return res.status(200).json(payload);
});

export const scrapeDecathlonController = asyncHandler(async (req, res) => {
  const payload = await runDecathlonSearch(req.validatedBody);

  return res.status(200).json(payload);
});