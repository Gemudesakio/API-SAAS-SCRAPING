import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 8080;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Servidor levantado en http://localhost:${PORT}`);
  });
}
