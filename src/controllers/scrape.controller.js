import asyncHandler from '../middlewares/async_handler.js';
import {
  runDecathlonSearch,
  runMercadoLibreSearch,
  runPepeGangaSearch,
  runFalabellaSearch,
  runExitoSearch,
  runHomecenterSearch,
} from '../services/scrape.service.js';

export const scrapeMercadoLibreController = asyncHandler(async (req, res) => {
  const payload = await runMercadoLibreSearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapeDecathlonController = asyncHandler(async (req, res) => {
  const payload = await runDecathlonSearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapePepeGangaController = asyncHandler(async (req, res) => {
  const payload = await runPepeGangaSearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapeFalabellaController = asyncHandler(async (req, res) => {
  const payload = await runFalabellaSearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapeExitoController = asyncHandler(async (req, res) => {
  const payload = await runExitoSearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapeHomecenterController = asyncHandler(async (req, res) => {
  const payload = await runHomecenterSearch(req.validatedBody);
  return res.status(200).json(payload);
});