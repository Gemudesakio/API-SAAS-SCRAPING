import asyncHandler from '../middlewares/async_handler.js';
import {
  runDecathlonSearch,
  runMercadoLibreSearch,
  runPepeGangaSearch,
  runFalabellaSearch,
  runExitoSearch,
  runHomecenterSearch,
  runAmazonSearch,
  runEbaySearch,
  runAliExpressSearch,
  runFacebookScrape,
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

export const scrapeAmazonController = asyncHandler(async (req, res) => {
  const payload = await runAmazonSearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapeEbayController = asyncHandler(async (req, res) => {
  const payload = await runEbaySearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapeAliExpressController = asyncHandler(async (req, res) => {
  const payload = await runAliExpressSearch(req.validatedBody);
  return res.status(200).json(payload);
});

export const scrapeFacebookController = asyncHandler(async (req, res) => {
  const payload = await runFacebookScrape(req.validatedBody);
  return res.status(200).json(payload);
});