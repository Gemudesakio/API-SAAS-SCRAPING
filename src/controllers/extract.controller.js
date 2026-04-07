import { universalScrape } from '../services/universal-scraper.service.js';
import { getAvailableModels } from '../services/clients/llm.client.js';

export async function extractController(req, res) {
  const { url, prompt, model, schema, options } = req.validatedBody;

  const result = await universalScrape({ url, prompt, model, schema, options });

  res.json({
    success: true,
    data: result,
  });
}

export function modelsController(req, res) {
  res.json({ models: getAvailableModels() });
}
