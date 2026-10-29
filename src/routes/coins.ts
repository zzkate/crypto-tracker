import { Router } from 'express';
import type { AppContext } from '../context';
import { isUniqueViolation } from '../db';
import { HttpError } from '../middleware/error';
import {
  countCoins,
  createCoin,
  deleteCoin,
  getCoin,
  listCoins,
  updateCoin
} from '../repositories/coins';
import { countPrices, getLatestPrice, listPrices } from '../repositories/prices';
import { parseCoinInput, parseHistoryQuery, parseId, parsePagination } from '../validation';
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
    handle((req, res) => {
      const { limit, offset } = parsePagination(req.query);
      res.set('X-Total-Count', String(countCoins(ctx.db)));
      res.json(listCoins(ctx.db, { limit, offset }));
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

      const current = getCoin(ctx.db, id);
      if (!current) throw new HttpError(404, 'coin not found', 'not_found');

      // PATCH идемпотентен: если данные не изменились, UPDATE не выполняем.
      const nextSymbol = input.symbol ?? current.symbol;
      const nextName = input.name ?? current.name;
      if (nextSymbol === current.symbol && nextName === current.name) {
        res.set('X-Changed', 'false');
        res.json(current);
        return;
      }

      try {
        const coin = updateCoin(ctx.db, id, input);
        if (!coin) throw new HttpError(404, 'coin not found', 'not_found');
        res.set('X-Changed', 'true');
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

      const { from, to, limit, offset } = parseHistoryQuery(req.query);
      res.set('X-Total-Count', String(countPrices(ctx.db, id, { from, to })));
      res.json(listPrices(ctx.db, id, { from, to, limit, offset }));
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
