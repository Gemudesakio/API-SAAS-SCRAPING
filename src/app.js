import express from 'express';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';
import routerIndex from './routes/index.js';
import notFoundHandler from './middlewares/not_found_handler.js';
import errorHandler from './middlewares/error_handler.js';

const app = express();

app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type')?.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

app.use('/api', routerIndex);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;