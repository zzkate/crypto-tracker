import request from 'supertest';
import { createCoin } from '../src/repositories/coins';
import { insertPrice } from '../src/repositories/prices';
import type { CmcClient } from '../src/services/coinmarketcap';
import { PriceSyncService } from '../src/services/sync';
import { AUTH, makeContext, type TestContext } from './helpers';

function addCoin(ctx: TestContext, symbol: string, name: string): number {
  return createCoin(ctx.db, {
    symbol,
    name,
    priceCurrency: ctx.config.currency,
    createdAt: new Date().toISOString()
  }).id;
}

describe('price synchronization service', () => {
  let ctx: TestContext;

  afterEach(() => {
    ctx.db.close();
  });

  it('сохраняет цены всех найденных монет', async () => {
    const fetchPrices = jest
      .fn()
      .mockResolvedValue(new Map([
        ['BTC', 50000],
        ['ETH', 3000]
      ]));
    ctx = makeContext({ client: { fetchPrices } });
    const btc = addCoin(ctx, 'BTC', 'Bitcoin');
    const eth = addCoin(ctx, 'ETH', 'Ethereum');

    const result = await ctx.syncService.syncOnce(new Date('2026-02-01T10:00:00.000Z'));

    expect(result).toEqual({ updated: 2, skipped: 0 });
    expect(fetchPrices).toHaveBeenCalledWith(['BTC', 'ETH'], 'USD');

    const btcPrices = ctx.db
      .prepare('SELECT price, currency, fetched_at FROM price_history WHERE coin_id = ?')
      .all(btc);
    expect(btcPrices).toHaveLength(1);
    expect(btcPrices[0]).toMatchObject({ price: 50000, currency: 'USD' });

    const coinRow = ctx.db
      .prepare('SELECT last_updated_at FROM coins WHERE id = ?')
      .get(eth) as { last_updated_at: string };
    expect(coinRow.last_updated_at).toBe('2026-02-01T10:00:00.000Z');
  });

  it('пропускает монеты, которых нет в ответе внешнего API', async () => {
    const fetchPrices = jest.fn().mockResolvedValue(new Map([['BTC', 50000]]));
    ctx = makeContext({ client: { fetchPrices } });
    addCoin(ctx, 'BTC', 'Bitcoin');
    addCoin(ctx, 'ETH', 'Ethereum');

    const result = await ctx.syncService.syncOnce();
    expect(result).toEqual({ updated: 1, skipped: 1 });
  });

  it('не пишет ничего, если внешний API вернул ошибку', async () => {
    const fetchPrices = jest.fn().mockRejectedValue(new Error('CoinMarketCap timeout'));
    ctx = makeContext({ client: { fetchPrices } });
    addCoin(ctx, 'BTC', 'Bitcoin');

    await expect(ctx.syncService.syncOnce()).rejects.toThrow('CoinMarketCap timeout');

    const rows = ctx.db.prepare('SELECT * FROM price_history').all();
    expect(rows).toHaveLength(0);

    const coin = ctx.db
      .prepare('SELECT last_updated_at FROM coins WHERE symbol = ?')
      .get('BTC') as { last_updated_at: string | null };
    expect(coin.last_updated_at).toBeNull();
  });

  it('не обращается к API, если нет отслеживаемых монет', async () => {
    const fetchPrices = jest.fn();
    ctx = makeContext({ client: { fetchPrices } });

    const result = await ctx.syncService.syncOnce();
    expect(result).toEqual({ updated: 0, skipped: 0 });
    expect(fetchPrices).not.toHaveBeenCalled();
  });
});

describe('POST /api/sync', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('возвращает результат ручной синхронизации (200)', async () => {
    const client: CmcClient = {
      async fetchPrices(symbols) {
        return new Map(symbols.map((symbol) => [symbol, 42]));
      }
    };
    const ctx = makeContext({ client });
    addCoin(ctx, 'BTC', 'Bitcoin');

    const res = await request(ctx.app)
      .post('/api/sync')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1, skipped: 0 });

    const latest = await request(ctx.app)
      .get('/api/prices/latest')
      .set('Authorization', AUTH);
    expect(latest.body[0]).toMatchObject({ price: 42, currency: 'USD' });

    ctx.db.close();
  });

  it('возвращает 502 при ошибке внешнего API', async () => {
    const client: CmcClient = {
      async fetchPrices() {
        throw new Error('upstream unavailable');
      }
    };
    const ctx = makeContext({ client });
    addCoin(ctx, 'BTC', 'Bitcoin');

    const res = await request(ctx.app)
      .post('/api/sync')
      .set('Authorization', AUTH);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('upstream_error');

    ctx.db.close();
  });

  it('возвращает 401 без токена', async () => {
    const ctx = makeContext();
    const res = await request(ctx.app).post('/api/sync');
    expect(res.status).toBe(401);
    ctx.db.close();
  });
});

describe('PriceSyncService with real repository wiring', () => {
  it('пишет несколько точек истории', async () => {
    const client: CmcClient = {
      async fetchPrices() {
        return new Map([['BTC', 1]]);
      }
    };
    const ctx = makeContext({ client });
    const id = addCoin(ctx, 'BTC', 'Bitcoin');

    await ctx.syncService.syncOnce(new Date('2026-01-01T00:00:00.000Z'));
    await ctx.syncService.syncOnce(new Date('2026-01-02T00:00:00.000Z'));

    const count = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM price_history WHERE coin_id = ?')
      .get(id) as { n: number };
    expect(count.n).toBe(2);

    ctx.db.close();
  });
});
