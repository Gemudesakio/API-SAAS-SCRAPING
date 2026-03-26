# API SaaS Scraping

API Node.js + Express + Playwright para scraping robusto de Mercado Libre y Decathlon, con salida normalizada para integracion con n8n.

## Stack

- Node.js (ESM)
- Express
- Playwright (Chromium)
- Docker (imagen oficial Playwright)

## Estructura principal

```text
src/
  app.js
  server.js
  routes/
  controllers/
  services/
    scrapers/
    normalizers/
  middlewares/
  validators/
  docs/
```

## Variables de entorno

| Variable | Requerida | Default | Descripcion |
|---|---|---|---|
| `PORT` | No | `8080` | Puerto interno de la API |
| `NODE_ENV` | No | `development` | Entorno de ejecucion |
| `SCRAPER_MAX_CONCURRENCY` | No | `2` | Maximo de scrapers Playwright ejecutandose al mismo tiempo |
| `SCRAPER_MAX_QUEUE` | No | `12` | Maximo de requests esperando turno cuando la concurrencia esta ocupada |
| `SCRAPER_QUEUE_TIMEOUT_MS` | No | `15000` | Tiempo maximo en cola antes de responder `429` |

## Ejecucion local

```bash
npm install
npm run dev
```

Healthcheck local:

```bash
curl http://localhost:8080/api/health
```

## Documentacion Swagger

- UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/docs/openapi.json`

Ejemplo local:

```bash
http://localhost:8080/api/docs
```

## Endpoints principales

- `GET /api/health`
- `POST /api/scrape/mercadolibre/search`
- `POST /api/scrape/decathlon/search`

Body base para scraping:

```json
{
  "query": "segway",
  "maxItems": 20,
  "maxPages": 3,
  "headless": true
}
```

Tambien puedes usar `url` en lugar de `query`.

## Docker

Build:

```bash
docker build -t api-saas-scraping:local .
```

Run:

```bash
docker run --rm -p 8080:8080 --name api-saas-scraping api-saas-scraping:local
```

Prueba:

```bash
curl http://localhost:8080/api/health
```

## Despliegue en EasyPanel (App Service)

1. Sube el repo a Git (con `Dockerfile` en raiz).
2. En EasyPanel: `New Service` -> `App Service`.
3. Fuente: Git repository.
4. Build method: **Dockerfile**.
5. Variables de entorno:
   - `NODE_ENV=production`
   - `PORT=8080`
   - `SCRAPER_MAX_CONCURRENCY=2`
   - `SCRAPER_MAX_QUEUE=12`
   - `SCRAPER_QUEUE_TIMEOUT_MS=15000`
6. Internal Port: `8080`.
7. Configura dominio y SSL en el servicio.
8. Despliega.

## Validacion post-deploy

Health:

```bash
curl -i https://TU_DOMINIO/api/health
```

Mercado Libre:

```bash
curl -X POST https://TU_DOMINIO/api/scrape/mercadolibre/search \
  -H "Content-Type: application/json" \
  -d '{"query":"segway","maxItems":2,"headless":true}'
```

Decathlon:

```bash
curl -X POST https://TU_DOMINIO/api/scrape/decathlon/search \
  -H "Content-Type: application/json" \
  -d '{"query":"segway","maxItems":2,"headless":true}'
```

## Operacion y logs

- Revisa logs de build en EasyPanel para errores de `npm ci`.
- Revisa logs runtime para:
  - `BOT_CHALLENGE`
  - `SCRAPER_QUEUE_FULL`
  - `SCRAPER_QUEUE_TIMEOUT`
  - errores de Playwright
  - reinicios del contenedor
  - errores `5xx`

## Rollback operativo

### Opcion A: rollback por commit (recomendado)

1. Identifica el ultimo commit estable.
2. Re-deploy del servicio apuntando a ese commit/tag.
3. Verifica `GET /api/health`.
4. Ejecuta un smoke test de ambos endpoints de scraping.

### Opcion B: rollback por imagen Docker (si manejas registry)

1. Selecciona la ultima imagen estable.
2. Re-despliega el servicio con esa imagen.
3. Repite pruebas de health y scraping.

## Checklist de release

- Build Docker exitoso.
- Healthcheck en `200`.
- Scraping Mercado Libre y Decathlon en `200`.
- Swagger accesible.
- Sin reinicios anormales en logs.
