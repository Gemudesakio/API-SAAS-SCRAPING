// ─── Helper: generate scraper endpoint for a store ─────────────────────
function storeEndpoint(site, displayName, extra = '') {
  return {
    post: {
      tags: ['Scraping — Stores'],
      summary: `Search products on ${displayName}`,
      description: `Scrape product listings from ${displayName}.${extra ? ' ' + extra : ''}`,
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapeRequest' } } },
      },
      responses: {
        200: { description: 'Products found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapeSuccess' } } } },
        400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        429: { description: 'Rate limit or queue full', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        503: { description: 'Anti-bot block or external service unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      },
    },
  };
}

// ─── Schemas ────────────────────────────────────────────────────────────

const scrapeRequestSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 2, description: 'Search query. Required if url is not provided.', example: 'laptop' },
    url: { type: 'string', format: 'uri', description: 'Direct listing URL. Required if query is not provided.', example: 'https://listado.mercadolibre.com.co/laptop' },
    maxItems: { type: 'integer', minimum: 1, maximum: 100, default: 20, example: 20 },
    maxPages: { type: 'integer', minimum: 1, maximum: 10, default: 3, example: 3 },
    headless: { type: 'boolean', default: true, description: 'Run browser in headless mode' },
  },
  description: 'At least one of `query` or `url` must be provided.',
  anyOf: [{ required: ['query'] }, { required: ['url'] }],
};

const productSchema = {
  type: 'object',
  properties: {
    COMPE_ID: { type: 'string', example: 'cp_ff800c28' },
    NOMBRE: { type: 'string', example: 'Portátil HP 15.6" AMD Ryzen 7' },
    PRECIO: { type: 'integer', example: 2499000, description: 'Price in COP (integer)' },
    STOCK: { type: 'string', enum: ['DISPONIBLE', 'AGOTADO'], example: 'DISPONIBLE' },
    availability_raw: { type: 'string', example: 'InStock' },
    URL: { type: 'string', format: 'uri' },
    IMAGEN: { type: 'string', format: 'uri' },
    PROVEEDOR: { type: 'string', example: 'MercadoLibre' },
  },
};

const scrapeSuccessSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: true },
    site: { type: 'string', example: 'mercadolibre' },
    count: { type: 'integer', example: 20 },
    products: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
    meta: {
      type: 'object',
      properties: {
        status: { type: 'integer', nullable: true, example: 200 },
        finalUrl: { type: 'string', format: 'uri' },
        pagesVisited: { type: 'integer', example: 1 },
        pagination: {
          type: 'object',
          properties: {
            requestedMaxItems: { type: 'integer', example: 20 },
            maxPages: { type: 'integer', example: 3 },
            collectedItems: { type: 'integer', example: 20 },
          },
        },
        limiter: {
          type: 'object',
          properties: {
            queue: { type: 'integer', example: 0 },
            active: { type: 'integer', example: 1 },
          },
        },
      },
    },
  },
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: false },
    error: { type: 'string', example: 'Invalid input' },
    code: {
      type: 'string',
      example: 'VALIDATION_ERROR',
      description: 'Error codes: VALIDATION_ERROR, UNAUTHORIZED, TOO_MANY_REQUESTS, BOT_CHALLENGE, SCRAPER_TIMEOUT, SCRAPER_QUEUE_FULL, SCRAPER_QUEUE_TIMEOUT, NO_RESULTS, FETCH_ALL_ENGINES_FAILED, INTERNAL_ERROR',
    },
    details: {
      nullable: true,
      oneOf: [
        { type: 'null' },
        { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
      ],
    },
  },
};

const facebookRequestSchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', description: 'Facebook page URL (must contain facebook.com)', example: 'https://www.facebook.com/AlcaldiadeMelgar' },
    maxItems: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Maximum number of posts to extract', example: 15 },
    timeout: { type: 'integer', minimum: 10000, maximum: 180000, default: 90000, description: 'Timeout in milliseconds', example: 90000 },
  },
};

const facebookPostSchema = {
  type: 'object',
  properties: {
    index: { type: 'integer', example: 1 },
    text: { type: 'string', example: '#MelgarEsBienestar | La Comisaría de Familia de Melgar protege...' },
  },
};

const facebookResponseSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: true },
    site: { type: 'string', example: 'facebook' },
    posts: { type: 'array', items: { $ref: '#/components/schemas/FacebookPost' } },
    meta: {
      type: 'object',
      properties: {
        pageUrl: { type: 'string', format: 'uri' },
        pageName: { type: 'string', example: 'Alcaldía de Melgar' },
        followers: { type: 'string', example: '38 mil seguidores' },
        totalPosts: { type: 'integer', example: 15 },
        authenticated: { type: 'boolean', description: 'Whether Facebook session cookies were used' },
      },
    },
  },
};

const extractRequestSchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', description: 'URL to scrape', example: 'https://en.wikipedia.org/wiki/Node.js' },
    prompt: { type: 'string', minLength: 5, maxLength: 5000, description: 'Extraction instruction for the LLM', example: 'Extract: title, description, main topics. JSON object.' },
    model: { type: 'string', description: 'LLM model to use (see GET /extract/models)', example: 'gemini-2.0-flash' },
    schema: { type: 'object', additionalProperties: true, description: 'Optional JSON schema for structured output' },
    options: {
      type: 'object',
      properties: {
        render: { type: 'boolean', default: false, description: 'Use Playwright for JS-rendered pages (SPAs)' },
        proxy: { type: 'boolean', default: false, description: 'Use residential proxy (DataImpulse)' },
        waitFor: { type: 'string', description: 'CSS selector to wait for before capturing' },
        timeout: { type: 'integer', minimum: 5000, maximum: 120000, default: 30000 },
        formats: { type: 'array', items: { type: 'string', enum: ['json', 'markdown'] }, default: ['json'], description: 'Output format(s). json requires a prompt.' },
        maxPages: { type: 'integer', minimum: 1, maximum: 5, default: 1, description: 'Number of pages to scrape (pagination)' },
        pageParam: { type: 'string', maxLength: 50, description: 'Query parameter name for pagination (e.g. "page")' },
        waitForScript: { type: 'boolean', default: false, description: 'Wait for __NEXT_DATA__ or JSON-LD structured data' },
        scroll: { type: 'integer', minimum: 0, maximum: 10, default: 0, description: 'Number of scroll iterations for infinite-scroll pages' },
      },
    },
  },
};

const scrapeAllRequestSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 2, description: 'Search query (required)', example: 'laptop' },
    maxItems: { type: 'integer', minimum: 1, maximum: 100, default: 20, example: 20 },
    maxPages: { type: 'integer', minimum: 1, maximum: 10, default: 3, example: 3 },
  },
};

// ─── OpenAPI Document ───────────────────────────────────────────────────

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'API SaaS Scraping',
    version: '2.0.0',
    description: `REST API for scraping product data from multiple e-commerce stores, Facebook pages, and any website using AI-powered extraction.

## Features
- **9 store scrapers**: MercadoLibre, Falabella, Éxito, Decathlon, Homecenter, PepeGanga, Amazon, eBay, AliExpress
- **Facebook scraper**: Extract posts from public Facebook pages (requires auth cookies)
- **Universal extractor**: Scrape any URL and extract structured data using LLM (Gemini, GPT, Groq)
- **Multi-site search**: Search all stores simultaneously via SSE streaming

## Authentication
All endpoints require an API key via the \`x-api-key\` header (or \`api_key\` query parameter).

## Rate Limiting
Default: 30 requests per minute. Configurable via \`RATE_LIMIT_RPM\` env var.

## SSE Endpoints
\`/extract\` and \`/all/search\` return Server-Sent Events (SSE). Use \`fetch\` + \`ReadableStream\` (not \`EventSource\`, since these are POST endpoints).
- Events: \`event: <name>\\ndata: <json>\\n\\n\`
- Heartbeat: \`: heartbeat\\n\\n\` every 15s (keeps connection alive behind proxies)`,
  },
  servers: [
    { url: '/', description: 'Current server' },
  ],
  tags: [
    { name: 'Health', description: 'Service health check' },
    { name: 'Scraping — Stores', description: 'Product search across e-commerce stores' },
    { name: 'Scraping — Facebook', description: 'Facebook public page post extraction' },
    { name: 'Scraping — Multi-site', description: 'Search all stores simultaneously (SSE stream)' },
    { name: 'Extract — Universal', description: 'AI-powered web scraping and data extraction (SSE stream)' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'API key for authentication. Also accepted as `api_key` query parameter.',
      },
    },
    schemas: {
      ScrapeRequest: scrapeRequestSchema,
      Product: productSchema,
      ScrapeSuccess: scrapeSuccessSchema,
      ErrorResponse: errorResponseSchema,
      FacebookRequest: facebookRequestSchema,
      FacebookPost: facebookPostSchema,
      FacebookResponse: facebookResponseSchema,
      ExtractRequest: extractRequestSchema,
      ScrapeAllRequest: scrapeAllRequestSchema,
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    // ─── Health ───────────────────────────────────────────
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Service health check',
        security: [],
        responses: {
          200: {
            description: 'Service is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    service: { type: 'string', example: 'api-scraping' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── Store Scrapers ───────────────────────────────────
    '/api/scrape/mercadolibre/search': storeEndpoint('mercadolibre', 'MercadoLibre', 'Uses Playwright with anti-detection and optional rotating proxy.'),
    '/api/scrape/decathlon/search': storeEndpoint('decathlon', 'Decathlon', 'Uses FlareSolverr for Cloudflare bypass.'),
    '/api/scrape/pepeganga/search': storeEndpoint('pepeganga', 'PepeGanga', 'Uses Impresee Search API (direct HTTP, no browser).'),
    '/api/scrape/falabella/search': storeEndpoint('falabella', 'Falabella', 'Parses __NEXT_DATA__ from server-rendered HTML.'),
    '/api/scrape/exito/search': storeEndpoint('exito', 'Éxito', 'Uses VTEX Catalog API (direct HTTP).'),
    '/api/scrape/homecenter/search': storeEndpoint('homecenter', 'Homecenter', 'Parses __NEXT_DATA__ or DOM from rendered HTML.'),
    '/api/scrape/amazon/search': storeEndpoint('amazon', 'Amazon', 'Aggressive anti-bot. May require proxy.'),
    '/api/scrape/ebay/search': storeEndpoint('ebay', 'eBay'),
    '/api/scrape/aliexpress/search': storeEndpoint('aliexpress', 'AliExpress'),

    // ─── Facebook ─────────────────────────────────────────
    '/api/scrape/facebook/posts': {
      post: {
        tags: ['Scraping — Facebook'],
        summary: 'Extract posts from a public Facebook page',
        description: `Scrapes posts from a public Facebook page using Playwright with scroll-and-capture technique.

**Authentication**: Requires \`FB_STORAGE_STATE\` environment variable with base64-encoded browser cookies. Without cookies, only 1-2 posts are visible. With cookies, 10-50+ posts can be extracted.

**Setup**: Run \`node scripts/fb-login.js\` to generate cookies via manual Facebook login.`,
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/FacebookRequest' } } },
        },
        responses: {
          200: { description: 'Posts extracted', content: { 'application/json': { schema: { $ref: '#/components/schemas/FacebookResponse' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          429: { description: 'Rate limit or queue full', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },

    // ─── Multi-site Search (SSE) ──────────────────────────
    '/api/scrape/all/search': {
      post: {
        tags: ['Scraping — Multi-site'],
        summary: 'Search all stores simultaneously (SSE stream)',
        description: `Searches all 9 stores in parallel and streams results via Server-Sent Events.

**SSE Events:**
- \`start\`: \`{ total, sites[], query }\`
- \`site-result\`: \`{ type, site, ok, count, products[], elapsed }\`
- \`site-error\`: \`{ type, site, ok: false, error, code }\`
- \`progress\`: \`{ completed, total, pending[] }\`
- \`done\`: \`{ total, succeeded, failed, totalProducts, elapsed }\`

**Note:** Use \`fetch\` + \`ReadableStream\` to consume (not \`EventSource\`, since this is a POST endpoint).`,
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ScrapeAllRequest' } } },
        },
        responses: {
          200: {
            description: 'SSE stream of scraping results',
            content: {
              'text/event-stream': {
                schema: { type: 'string', description: 'Server-Sent Events stream' },
              },
            },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },

    // ─── Extract — Models ─────────────────────────────────
    '/api/scrape/extract/models': {
      get: {
        tags: ['Extract — Universal'],
        summary: 'List available LLM models',
        description: 'Returns the list of LLM models configured and available for extraction.',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          200: {
            description: 'Available models',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    models: {
                      type: 'array',
                      items: { type: 'string' },
                      example: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gpt-4o-mini'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ─── Extract — Universal Scraper (SSE) ────────────────
    '/api/scrape/extract': {
      post: {
        tags: ['Extract — Universal'],
        summary: 'Scrape any URL and extract data with LLM (SSE stream)',
        description: `Universal web scraper that fetches any URL, converts to markdown, and optionally extracts structured data using an LLM.

**Cascade engine:** HTTP fetch → Playwright (with stealth) → FlareSolverr (if configured)

**SSE Events:**
- \`status\`: Progress updates — \`{ phase: "scraping"|"scraped"|"extracting"|"pagination", page, engine, url }\`
- \`result\`: Final result — \`{ success: true, data: { metadata, json?, markdown? } }\`
- \`error\`: Error — \`{ ok: false, error, code }\`
- Heartbeat: \`: heartbeat\\n\\n\` every 15s

**Output formats:**
- \`json\`: Requires \`prompt\`. LLM extracts structured JSON from the page content.
- \`markdown\`: Returns cleaned markdown of the page. No LLM needed.

**Options:**
- \`render: true\`: Use Playwright for JS-rendered pages (SPAs like Alkosto, IKEA)
- \`proxy: true\`: Use residential proxy (useful for MercadoLibre)
- \`scroll: 5\`: Scroll page 5 times for infinite-scroll content (Facebook, social media)
- \`waitForScript: true\`: Wait for __NEXT_DATA__ or JSON-LD structured data
- \`maxPages: 3\`: Follow pagination up to 3 pages`,
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ExtractRequest' } } },
        },
        responses: {
          200: {
            description: 'SSE stream with scraping progress and final result',
            content: {
              'text/event-stream': {
                schema: { type: 'string', description: 'Server-Sent Events stream' },
              },
            },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
  },
};
