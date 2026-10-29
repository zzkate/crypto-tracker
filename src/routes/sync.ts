import { Router } from 'express';
import type { AppContext } from '../context';
import { HttpError } from '../middleware/error';
import { handleAsync } from './helpers';

export function syncRouter(ctx: AppContext): Router {
  const router = Router();

  router.post(
    '/',
    handleAsync(async (_req, res) => {
      try {
        const result = await ctx.syncService.syncOnce();
        res.json(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'CoinMarketCap request failed';
        throw new HttpError(502, message, 'upstream_error');
      }
    })
  );

  return router;
}
