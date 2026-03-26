const scrapeRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
      minLength: 2,
      description: 'Texto de busqueda. Requerido si no se envia url.',
      example: 'segway',
    },
    url: {
      type: 'string',
      format: 'uri',
      description: 'URL directa del listado de la tienda. Requerido si no se envia query.',
      example: 'https://listado.mercadolibre.com.co/segway',
    },
    maxItems: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
      example: 20,
    },
    maxPages: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      default: 3,
      example: 3,
    },
    headless: {
      type: 'boolean',
      default: true,
      example: true,
    },
  },
  description: 'Debe incluir al menos uno de estos campos: query o url.',
  anyOf: [{ required: ['query'] }, { required: ['url'] }],
};

const productSchema = {
  type: 'object',
  properties: {
    COMPE_ID: { type: 'string', example: 'cp_ff800c28' },
    NOMBRE: { type: 'string', example: 'Scooter Eléctrico Segway F40' },
    PRECIO: { type: 'integer', example: 2373750 },
    STOCK: { type: 'string', example: 'DISPONIBLE' },
    availability_raw: { type: 'string', example: 'InStock' },
    URL: { type: 'string', format: 'uri' },
    IMAGEN: { type: 'string', format: 'uri' },
    PROVEEDOR: { type: 'string', example: 'MercadoLibre' },
  },
};

const scrapeSuccessResponse = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: true },
    site: { type: 'string', example: 'mercadolibre' },
    count: { type: 'integer', example: 2 },
    products: {
      type: 'array',
      items: { $ref: '#/components/schemas/Product' },
    },
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
      },
    },
  },
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: false },
    error: { type: 'string', example: 'Invalid input' },
    code: { type: 'string', example: 'VALIDATION_ERROR' },
    details: {
      oneOf: [
        { type: 'null' },
        {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', example: 'query' },
              message: { type: 'string', example: 'query debe tener al menos 2 caracteres' },
            },
          },
        },
        {
          type: 'object',
          properties: {
            reason: { type: 'string', example: 'selector_not_found' },
            site: { type: 'string', example: 'mercadolibre' },
            status: { type: 'integer', nullable: true, example: 403 },
            pageUrl: { type: 'string', format: 'uri' },
            pageTitle: { type: 'string' },
            bodyPreview: { type: 'string' },
            screenshotPath: { type: 'string', nullable: true, example: '/tmp/scraper-debug/mercadolibre/1234.png' },
            htmlPath: { type: 'string', nullable: true, example: '/tmp/scraper-debug/mercadolibre/1234.html' },
            debugEnabled: { type: 'boolean', example: true },
          },
        },
      ],
    },
  },
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'API SaaS Scraping',
    version: '1.0.0',
    description:
      'API de scraping para Mercado Libre y Decathlon usando Playwright. Respuesta normalizada para n8n.',
  },
  servers: [
    {
      url: '/',
      description: 'Servidor actual',
    },
  ],
  tags: [
    { name: 'Health' },
    { name: 'Scraping' },
  ],
  components: {
    schemas: {
      ScrapeRequest: scrapeRequestSchema,
      Product: productSchema,
      ScrapeSuccess: scrapeSuccessResponse,
      ErrorResponse: errorResponseSchema,
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Healthcheck del servicio',
        responses: {
          200: {
            description: 'Servicio activo',
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
    '/api/scrape/mercadolibre/search': {
      post: {
        tags: ['Scraping'],
        summary: 'Busca productos en Mercado Libre',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScrapeRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Scraping exitoso',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScrapeSuccess' },
              },
            },
          },
          400: {
            description: 'Error de validacion',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          503: {
            description: 'Bloqueo anti-bot o servicio externo no disponible',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          429: {
            description: 'Cola de scraping llena o timeout en cola',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/scrape/decathlon/search': {
      post: {
        tags: ['Scraping'],
        summary: 'Busca productos en Decathlon',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ScrapeRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Scraping exitoso',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScrapeSuccess' },
              },
            },
          },
          400: {
            description: 'Error de validacion',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          503: {
            description: 'Bloqueo anti-bot o servicio externo no disponible',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          429: {
            description: 'Cola de scraping llena o timeout en cola',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
};
