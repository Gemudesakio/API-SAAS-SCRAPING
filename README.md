# API SaaS Scraping

REST API for scraping product data from multiple e-commerce stores, Facebook pages, and any website using AI-powered extraction. Built with Node.js + Express, consumed by n8n automation workflows.

## Stack

- **Runtime**: Node.js 20, ESM modules
- **Framework**: Express 5
- **Scraping**: Playwright (Chrome new headless), FlareSolverr (Cloudflare bypass), Cheerio
- **HTML processing**: JSDOM, Readability, node-html-markdown
- **LLM extraction**: Gemini, OpenAI, Groq, DeepSeek, Cerebras
- **Validation**: Zod
- **Security**: Helmet, express-rate-limit, API key auth
- **Docs**: Swagger UI (OpenAPI 3.0)
- **Deploy**: Docker (`mcr.microsoft.com/playwright:v1.58.2-noble`) on EasyPanel

## Endpoints

### Scraping — Stores (9 endpoints)

All use the same request schema: `{ query, url, maxItems, maxPages, headless }`

| Endpoint | Store | Engine |
|----------|-------|--------|
| `POST /api/scrape/mercadolibre/search` | MercadoLibre | Playwright + proxy |
| `POST /api/scrape/decathlon/search` | Decathlon | FlareSolverr |
| `POST /api/scrape/pepeganga/search` | PepeGanga | HTTP (Impresee API) |
| `POST /api/scrape/falabella/search` | Falabella | HTTP (__NEXT_DATA__) |
| `POST /api/scrape/exito/search` | Éxito | HTTP (VTEX API) |
| `POST /api/scrape/homecenter/search` | Homecenter | HTTP / FlareSolverr |
| `POST /api/scrape/amazon/search` | Amazon | Playwright + proxy |
| `POST /api/scrape/ebay/search` | eBay | HTTP |
| `POST /api/scrape/aliexpress/search` | AliExpress | HTTP |

### Scraping — Facebook

| Endpoint | Description |
|----------|-------------|
| `POST /api/scrape/facebook/posts` | Extract posts from a public Facebook page. Requires `FB_STORAGE_STATE` cookies. |

### Extract — Universal (SSE)

| Endpoint | Description |
|----------|-------------|
| `POST /api/scrape/extract` | Scrape any URL + extract data with LLM. Returns SSE stream. |
| `GET /api/scrape/extract/models` | List available LLM models |

### Multi-site Search (SSE)

| Endpoint | Description |
|----------|-------------|
| `POST /api/scrape/all/search` | Search all 9 stores simultaneously. Returns SSE stream. |

### Health

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health check |

## Project Structure

```
src/
├── app.js                          # Express app (middleware, routes)
├── server.js                       # Entry point (port, graceful shutdown)
├── routes/
│   ├── scrape.routes.js            # All scraping endpoints
│   ├── health.routes.js            # Health check
│   └── docs.routes.js              # Swagger UI
├── controllers/
│   ├── scrape.controller.js        # Store + Facebook controllers
│   ├── scrape-all.controller.js    # Multi-site SSE controller
│   └── extract.controller.js       # Universal extractor SSE controller
├── services/
│   ├── scrapers/
│   │   ├── mercadolibre.scraper.js # Playwright-based
│   │   ├── decathlon.scraper.js    # FlareSolverr-based
│   │   ├── pepeganga.scraper.js    # Impresee Search API
│   │   ├── falabella.scraper.js    # __NEXT_DATA__ parser
│   │   ├── exito.scraper.js        # VTEX Catalog API
│   │   ├── homecenter.scraper.js   # FlareSolverr / __NEXT_DATA__
│   │   ├── amazon.scraper.js       # Playwright + proxy
│   │   ├── ebay.scraper.js         # HTTP
│   │   ├── aliexpress.scraper.js   # HTTP
│   │   └── facebook.scraper.js     # Playwright + cookies + scroll
│   ├── normalizers/
│   │   └── product.normalizer.js   # Standardized product output
│   ├── clients/
│   │   ├── browser-pool.js         # Singleton Playwright browser + auth context
│   │   ├── flaresolverr.client.js  # FlareSolverr HTTP client
│   │   ├── html-cleaner.js         # HTML → markdown pipeline
│   │   └── llm.client.js           # Multi-provider LLM client
│   ├── universal-scraper.service.js # Cascade engine (fetch → Playwright → FlareSolverr)
│   ├── scrape.service.js           # Store scraping orchestrator
│   └── scrape-all.service.js       # Multi-site parallel orchestrator
├── middlewares/
│   ├── api-key.js                  # x-api-key auth
│   ├── error_handler.js            # Global error handler
│   ├── validate_body.js            # Zod validation
│   └── async_handler.js            # Async error wrapper
├── validators/
│   ├── scrape.validator.js         # Store search schema
│   ├── extract.validator.js        # Universal extract schema
│   ├── facebook.validator.js       # Facebook schema
│   └── scrape-all.validator.js     # Multi-site schema
├── errors/                         # AppError, error codes, HTTP helpers
├── constants/
│   └── providers.js                # Store name mapping
├── utils/
│   ├── scraper-concurrency.js      # Queue limiter (configurable concurrency)
│   ├── scraper-diagnostics.js      # Screenshot + HTML dump for debugging
│   ├── scraper.helpers.js          # User agent, challenge detection, proxy config
│   ├── domain-engine-cache.js      # TTL cache for domain → engine mapping
│   └── url-validator.js            # SSRF protection (blocks private IPs)
├── docs/
│   └── openapi.js                  # OpenAPI 3.0 spec (14 endpoints)
└── scripts/
    └── fb-login.js                 # Facebook cookie setup (manual login)
```

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `NODE_ENV` | `development` | Environment |
| `API_KEY` | - | API key for authentication (optional, if unset auth is disabled) |
| `RATE_LIMIT_RPM` | `30` | Rate limit (requests per minute) |

### Scraper Concurrency

| Variable | Default | Description |
|----------|---------|-------------|
| `SCRAPER_MAX_CONCURRENCY` | `2` | Max parallel Playwright instances |
| `SCRAPER_MAX_QUEUE` | `12` | Max requests waiting in queue |
| `SCRAPER_QUEUE_TIMEOUT_MS` | `15000` | Queue wait timeout before 429 |
| `BROWSER_POOL_RECYCLE_AFTER` | `100` | Recycle browser after N requests |

### Proxy (residential)

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_URL` | - | Residential proxy URL. E.g. `http://user:pass@gw.dataimpulse.com:12002` |

### FlareSolverr

| Variable | Default | Description |
|----------|---------|-------------|
| `FLARESOLVERR_URL` | - | FlareSolverr endpoint. E.g. `http://proyectos-saas_flaresolverr:80/v1` |
| `FLARESOLVERR_TIMEOUT_MS` | `60000` | Max challenge resolution time |
| `FLARESOLVERR_REQUEST_TIMEOUT_MS` | `75000` | HTTP client timeout |
| `FLARESOLVERR_WAIT_SECONDS` | `1` | Post-challenge wait |
| `FLARESOLVERR_DISABLE_MEDIA` | `true` | Skip images/CSS/fonts |
| `FLARESOLVERR_USE_SESSION` | `true` | Reuse cookies across requests |
| `FLARESOLVERR_SESSION_TTL_MINUTES` | `7` | Session lifetime |

### LLM (for /extract endpoint)

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | - | Google Gemini API key (free tier available) |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `GROQ_API_KEY` | - | Groq API key (free tier available) |
| `DEEPSEEK_API_KEY` | - | DeepSeek API key |
| `CEREBRAS_API_KEY` | - | Cerebras API key (free tier available) |
| `LLM_DEFAULT_MODEL` | auto-select | Default LLM model |
| `LLM_MAX_TOKENS` | `16384` | Max output tokens |
| `LLM_TIMEOUT_MS` | `60000` | LLM request timeout |

### Facebook

| Variable | Default | Description |
|----------|---------|-------------|
| `FB_STORAGE_STATE` | - | Base64-encoded browser cookies from `scripts/fb-login.js` |
| `AUTH_STATE_PATH` | `/app/data/fb-state.json` | Path for cookie file persistence |

### Domain Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN_CACHE_TTL_MINUTES` | `30` | Cache TTL for domain → engine mapping |

### Debug

| Variable | Default | Description |
|----------|---------|-------------|
| `SCRAPER_DEBUG` | `false` | Enable screenshot/HTML dump on failures |
| `SCRAPER_DEBUG_SAVE_HTML` | `false` | Save full HTML alongside screenshots |
| `SCRAPER_DEBUG_DIR` | `/tmp/scraper-debug` | Debug artifacts directory |

## Quick Start

```bash
npm install
npm run dev
```

Test health:
```bash
curl http://localhost:8080/api/health
```

Search products:
```bash
curl -X POST http://localhost:8080/api/scrape/falabella/search \
  -H "Content-Type: application/json" \
  -d '{"query":"laptop","maxItems":5}'
```

Extract data from any URL:
```bash
curl -N -X POST http://localhost:8080/api/scrape/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"https://en.wikipedia.org/wiki/Node.js","prompt":"Extract: creator, year. JSON object."}'
```

Facebook posts:
```bash
# First, setup cookies (one-time):
node scripts/fb-login.js

# Then scrape:
curl -X POST http://localhost:8080/api/scrape/facebook/posts \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.facebook.com/PageName","maxItems":15}'
```

## Swagger Docs

- **UI**: `GET /api/docs`
- **JSON**: `GET /api/docs/openapi.json`

## Docker

```bash
docker build -t api-saas-scraping .
docker run --rm -p 8080:8080 api-saas-scraping
```

## Deploy (EasyPanel)

1. Push repo to Git (Dockerfile in root).
2. EasyPanel: New Service → App Service → Git source → Dockerfile build.
3. Set environment variables (see tables above).
4. Internal port: `8080`.
5. Add volume mount `/app/data` for Facebook cookie persistence.
6. Configure domain and SSL.
7. Deploy.

## SSE Endpoints

`/api/scrape/extract` and `/api/scrape/all/search` return Server-Sent Events.

These are POST endpoints — use `fetch` + `ReadableStream`, not `EventSource`:

```javascript
const res = await fetch('/api/scrape/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: '...', prompt: '...' }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
// Parse SSE: event: <name>\ndata: <json>\n\n
```

Heartbeat (`: heartbeat\n\n`) every 15s keeps connection alive behind Traefik.
