import { Router } from 'express';
import type { AppContext } from '../context';
import { listLatestPrices } from '../repositories/prices';
import { handle } from './helpers';

export function pricesRouter(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/latest',
    handle((_req, res) => {
      res.json(listLatestPrices(ctx.db));
    })
  );

  return router;
}
