# API SaaS Scraping

API Node.js + Express para scraping robusto (Mercado Libre con Playwright y Decathlon con FlareSolverr), con salida normalizada para integracion con n8n.

## Stack

- Node.js (ESM)
- Express
- Playwright (Chromium, usado en Mercado Libre)
- FlareSolverr (usado en Decathlon)
- Cheerio
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
| `SCRAPER_DEBUG` | No | `false` | Si es `true`, guarda screenshot de fallos de selector en `/tmp/scraper-debug` |
| `SCRAPER_DEBUG_SAVE_HTML` | No | `false` | Si es `true` y `SCRAPER_DEBUG=true`, guarda HTML completo en archivo |
| `SCRAPER_DEBUG_DIR` | No | `/tmp/scraper-debug` | Directorio donde se guardan artefactos de diagnóstico |
| `ML_PROXY_ENABLED` | No | `false` | Habilita proxy saliente solo para el scraper de Mercado Libre (Playwright) |
| `ML_PROXY_SERVER` | No | - | Servidor proxy para Mercado Libre. Ej: `http://gw.dataimpulse.com:823` |
| `ML_PROXY_USERNAME` | No | - | Usuario del proxy para Mercado Libre |
| `ML_PROXY_PASSWORD` | No | - | Password del proxy para Mercado Libre |
| `ML_PROXY_BYPASS` | No | - | Hosts a excluir del proxy en Playwright. Ej: `localhost,127.0.0.1` |
| `FLARESOLVERR_URL` | No | - | URL interna del servicio FlareSolverr. Ej: `http://proyectos-saas_flaresolverr:80/v1` |
| `FLARESOLVERR_TIMEOUT_MS` | No | `120000` | `maxTimeout` enviado a FlareSolverr por request |
| `FLARESOLVERR_WAIT_SECONDS` | No | `3` | Espera post-challenge antes de devolver HTML |
| `FLARESOLVERR_REQUEST_TIMEOUT_MS` | No | `130000` | Timeout HTTP cliente API -> FlareSolverr |
| `FLARESOLVERR_DISABLE_MEDIA` | No | `true` | Si es `true`, evita cargar imagen/CSS/fonts en FlareSolverr para reducir latencia |
| `FLARESOLVERR_USE_SESSION` | No | `true` | Reutiliza sesión/cookies en FlareSolverr entre requests para evitar resolver challenge en cada llamada |
| `FLARESOLVERR_SESSION_TTL_MINUTES` | No | `15` | Tiempo de vida de sesión reutilizada antes de rotarla |

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
   - `SCRAPER_DEBUG=false`
   - `SCRAPER_DEBUG_SAVE_HTML=false`
   - `SCRAPER_DEBUG_DIR=/tmp/scraper-debug`
   - `ML_PROXY_ENABLED=true`
   - `ML_PROXY_SERVER=http://gw.dataimpulse.com:823`
   - `ML_PROXY_USERNAME=TU_USUARIO_PROXY`
   - `ML_PROXY_PASSWORD=TU_PASSWORD_PROXY`
   - `ML_PROXY_BYPASS=localhost,127.0.0.1`
   - `FLARESOLVERR_URL=http://proyectos-saas_flaresolverr:80/v1`
   - `FLARESOLVERR_USE_SESSION=true`
   - `FLARESOLVERR_DISABLE_MEDIA=true`
6. Internal Port: `8080`.
7. Configura dominio y SSL en el servicio.
8. Despliega.

## Validacion post-deploy

Health:

```bash
curl -i https://TU_DOMINIO/api/health
```

Verifica salida del proxy desde la VPS:

```bash
curl -x "http://TU_USUARIO_PROXY:TU_PASSWORD_PROXY@gw.dataimpulse.com:823" \
  -s https://api.ipify.org?format=json
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

Si Mercado Libre responde `200`, valida en `meta` que el proxy quedó activo:

```json
"meta": {
  "engine": "playwright",
  "proxy": {
    "enabled": true,
    "server": "http://gw.dataimpulse.com:823"
  }
}
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

## Diagnostico anti-bot (temporal)

Para investigar bloqueos en producción:

1. Activa variables en EasyPanel:
   - `SCRAPER_DEBUG=true`
   - `SCRAPER_DEBUG_SAVE_HTML=true`
2. Haz deploy.
3. Ejecuta request fallida.
4. Revisa en la respuesta `details`:
   - `pageUrl`
   - `pageTitle`
   - `bodyPreview`
   - `screenshotPath`
   - `htmlPath` (si habilitaste guardado de html)
5. Cuando termines diagnóstico, vuelve a:
   - `SCRAPER_DEBUG=false`
   - `SCRAPER_DEBUG_SAVE_HTML=false`

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
