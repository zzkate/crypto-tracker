import { Router } from 'express';
import type { AppContext } from '../context';
import { isUniqueViolation } from '../db';
import { HttpError } from '../middleware/error';
import {
  createCoin,
  deleteCoin,
  getCoin,
  listCoins,
  updateCoin
} from '../repositories/coins';
import { getLatestPrice, listPrices } from '../repositories/prices';
import { parseCoinInput, parseHistoryQuery, parseId } from '../validation';
import { handle } from './helpers';

export function coinsRouter(ctx: AppContext): Router {
  const router = Router();

  router.post(
    '/',
    handle((req, res) => {
      const input = parseCoinInput(req.body, false);
      try {
        const coin = createCoin(ctx.db, {
          symbol: input.symbol!,
          name: input.name!,
          priceCurrency: ctx.config.currency,
          createdAt: new Date().toISOString()
        });
        res.status(201).json(coin);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            `coin with symbol ${input.symbol} already exists`,
            'conflict'
          );
        }
        throw error;
      }
    })
  );

  router.get(
    '/',
    handle((_req, res) => {
      res.json(listCoins(ctx.db));
    })
  );

  router.get(
    '/:id',
    handle((req, res) => {
      const id = parseId(req.params.id);
      const coin = getCoin(ctx.db, id);
      if (!coin) throw new HttpError(404, 'coin not found', 'not_found');
      res.json(coin);
    })
  );

  router.patch(
    '/:id',
    handle((req, res) => {
      const id = parseId(req.params.id);
      const input = parseCoinInput(req.body, true);

      if (!getCoin(ctx.db, id)) throw new HttpError(404, 'coin not found', 'not_found');

      try {
        const coin = updateCoin(ctx.db, id, input);
        if (!coin) throw new HttpError(404, 'coin not found', 'not_found');
        res.json(coin);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, 'coin with this symbol already exists', 'conflict');
        }
        throw error;
      }
    })
  );

  router.delete(
    '/:id',
    handle((req, res) => {
      const id = parseId(req.params.id);
      if (!deleteCoin(ctx.db, id)) throw new HttpError(404, 'coin not found', 'not_found');
      res.status(204).send();
    })
  );

  router.get(
    '/:id/prices',
    handle((req, res) => {
      const id = parseId(req.params.id);
      if (!getCoin(ctx.db, id)) throw new HttpError(404, 'coin not found', 'not_found');

      const { from, to, limit } = parseHistoryQuery(req.query);
      res.json(listPrices(ctx.db, id, { from, to, limit }));
    })
  );

  router.get(
    '/:id/prices/latest',
    handle((req, res) => {
      const id = parseId(req.params.id);
      if (!getCoin(ctx.db, id)) throw new HttpError(404, 'coin not found', 'not_found');

      const price = getLatestPrice(ctx.db, id);
      if (!price) throw new HttpError(404, 'price not found', 'not_found');
      res.json(price);
    })
  );

  return router;
}
