import { Router } from 'express';
import type { AppContext } from '../context';
import { countCoins } from '../repositories/coins';
import { listLatestPrices } from '../repositories/prices';
import { parsePagination } from '../validation';
import { handle } from './helpers';

export function pricesRouter(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/latest',
    handle((req, res) => {
      const { limit, offset } = parsePagination(req.query);
      res.set('X-Total-Count', String(countCoins(ctx.db)));
      res.json(listLatestPrices(ctx.db, { limit, offset }));
    })
  );

  return router;
}
