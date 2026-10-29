import express from 'express';
import swaggerUi from 'swagger-ui-express';
import type { AppContext } from './context';
import { bearerAuth } from './middleware/auth';
import { errorHandler, notFound } from './middleware/error';
import openapi from './openapi.json';
import { coinsRouter } from './routes/coins';
import { pricesRouter } from './routes/prices';
import { syncRouter } from './routes/sync';

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  const api = express.Router();
  api.use(bearerAuth(ctx.config.appApiKey));
  api.use('/coins', coinsRouter(ctx));
  api.use('/prices', pricesRouter(ctx));
  api.use('/sync', syncRouter(ctx));

  app.use('/api', api);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
