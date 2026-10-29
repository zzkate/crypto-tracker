import request from 'supertest';
import { createCoin } from '../src/repositories/coins';
import { insertPrice } from '../src/repositories/prices';
import type { CmcClient } from '../src/services/coinmarketcap';
import { isRetryableError, PriceSyncService } from '../src/services/sync';
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

describe('batching, retry, coalescing', () => {
  it('разбивает символы на батчи', async () => {
    const calls: string[][] = [];
    const client: CmcClient = {
      async fetchPrices(symbols) {
        calls.push([...symbols]);
        return new Map(symbols.map((s) => [s, 1]));
      }
    };

    const ctx = makeContext({ client });
    const service = new PriceSyncService(ctx.db, client, ctx.config.currency, {
      batchSize: 2
    });

    for (let i = 0; i < 5; i += 1) addCoin(ctx, `S${i}`, `Coin ${i}`);

    const result = await service.syncOnce();
    expect(result).toEqual({ updated: 5, skipped: 0 });
    expect(calls.map((c) => c.length)).toEqual([2, 2, 1]);

    ctx.db.close();
  });

  it('повторяет запрос при ошибке CMC (retry)', async () => {
    let attempts = 0;
    const client: CmcClient = {
      async fetchPrices(symbols) {
        attempts += 1;
        if (attempts < 3) throw new Error('transient failure');
        return new Map(symbols.map((s) => [s, 1]));
      }
    };

    const ctx = makeContext({ client });
    const service = new PriceSyncService(ctx.db, client, ctx.config.currency, {
      maxRetries: 3,
      retryBackoffMs: 1
    });
    addCoin(ctx, 'BTC', 'Bitcoin');

    const result = await service.syncOnce();
    expect(result.updated).toBe(1);
    expect(attempts).toBe(3);

    ctx.db.close();
  });

  it('объединяет параллельные вызовы в один запрос (coalescing)', async () => {
    let calls = 0;
    let release!: () => void;
    const client: CmcClient = {
      async fetchPrices(symbols) {
        calls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Map(symbols.map((s) => [s, 1]));
      }
    };

    const ctx = makeContext({ client });
    const service = new PriceSyncService(ctx.db, client, ctx.config.currency);
    addCoin(ctx, 'BTC', 'Bitcoin');

    const p1 = service.syncOnce();
    const p2 = service.syncOnce();
    expect(calls).toBe(1);

    release();
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);

    ctx.db.close();
  });
});

describe('retry policy', () => {
  it('isRetryableError: сеть/таймаут и 5xx/429 — true, 4xx — false', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError({ response: { status: 500 } })).toBe(true);
    expect(isRetryableError({ response: { status: 502 } })).toBe(true);
    expect(isRetryableError({ response: { status: 429 } })).toBe(true);

    expect(isRetryableError({ response: { status: 400 } })).toBe(false);
    expect(isRetryableError({ response: { status: 401 } })).toBe(false);
    expect(isRetryableError({ response: { status: 403 } })).toBe(false);
    expect(isRetryableError({ response: { status: 404 } })).toBe(false);
  });

  it('не ретраит 4xx (401)', async () => {
    let attempts = 0;
    const client: CmcClient = {
      async fetchPrices() {
        attempts += 1;
        const err = new Error('unauthorized') as Error & { response: { status: number } };
        err.response = { status: 401 };
        throw err;
      }
    };
    const ctx = makeContext({ client });
    const service = new PriceSyncService(ctx.db, client, ctx.config.currency, {
      maxRetries: 3,
      retryBackoffMs: 1
    });
    addCoin(ctx, 'BTC', 'Bitcoin');

    await expect(service.syncOnce()).rejects.toThrow('unauthorized');
    expect(attempts).toBe(1);

    ctx.db.close();
  });

  it('ретраит 429 и затем успешно', async () => {
    let attempts = 0;
    const client: CmcClient = {
      async fetchPrices(symbols) {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('rate limited') as Error & { response: { status: number } };
          err.response = { status: 429 };
          throw err;
        }
        return new Map(symbols.map((s) => [s, 42]));
      }
    };
    const ctx = makeContext({ client });
    const service = new PriceSyncService(ctx.db, client, ctx.config.currency, {
      maxRetries: 3,
      retryBackoffMs: 1
    });
    addCoin(ctx, 'BTC', 'Bitcoin');

    const result = await service.syncOnce();
    expect(result.updated).toBe(1);
    expect(attempts).toBe(2);

    ctx.db.close();
  });
});
