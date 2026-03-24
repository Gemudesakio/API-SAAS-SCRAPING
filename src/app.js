import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import routerIndex from './routes/index.js';
import notFoundHandler from './middlewares/not_found_handler.js';
import errorHandler from './middlewares/error_handler.js';

const app = express();

// Middlewares globales
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rutas
app.use('/api', routerIndex);

// Manejo de errores (siempre al final)
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
