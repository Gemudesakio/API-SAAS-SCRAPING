import { universalScrape } from '../services/universal-scraper.service.js';
import { getAvailableModels } from '../services/clients/llm.client.js';

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function extractController(req, res) {
  const { url, prompt, model, schema, options } = req.validatedBody;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  try {
    const result = await universalScrape(
      { url, prompt, model, schema, options },
      (progress) => sendSSE(res, 'status', progress)
    );

    clearInterval(heartbeat);
    sendSSE(res, 'result', { success: true, data: result });
  } catch (err) {
    clearInterval(heartbeat);
    sendSSE(res, 'error', {
      ok: false,
      error: err.message,
      code: err.code || 'INTERNAL_ERROR',
    });
  } finally {
    res.end();
  }
}

export function modelsController(req, res) {
  res.json({ models: getAvailableModels() });
}
