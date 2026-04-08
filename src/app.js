import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import routerIndex from './routes/index.js';
import apiKeyAuth from './middlewares/api-key.js';
import notFoundHandler from './middlewares/not_found_handler.js';
import errorHandler from './middlewares/error_handler.js';

const app = express();

app.use(helmet());
app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type')?.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cors());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_RPM) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests', code: 'RATE_LIMIT' },
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'api-scraping', timestamp: new Date().toISOString() });
});

app.use('/api/', apiLimiter);
app.use('/api/', apiKeyAuth);

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

app.use('/api', routerIndex);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;