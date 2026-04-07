import { runAllScrapersSearch, getSiteList } from '../services/scrape-all.service.js';

function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function scrapeAllController(req, res) {
  const { query, maxItems, maxPages } = req.validatedBody;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sites = getSiteList();
  const completedSites = new Set();

  sendEvent(res, 'start', { total: sites.length, sites, query });

  const summary = await runAllScrapersSearch(
    { query, maxItems, maxPages },
    (event) => {
      completedSites.add(event.site);
      sendEvent(res, event.type, event);
      sendEvent(res, 'progress', {
        completed: completedSites.size,
        total: sites.length,
        pending: sites.filter(s => !completedSites.has(s)),
      });
    }
  );

  sendEvent(res, 'done', summary);
  res.end();
}
