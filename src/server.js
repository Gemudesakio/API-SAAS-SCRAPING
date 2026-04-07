import 'dotenv/config';
import app from './app.js';
import { closeBrowser } from './services/clients/browser-pool.js';

const PORT = Number(process.env.PORT || 8080);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor levantado en puerto ${PORT}`);
});

async function gracefulShutdown(signal) {
  console.log(`${signal} received — closing browser pool and server`);
  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();
  await closeBrowser();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));