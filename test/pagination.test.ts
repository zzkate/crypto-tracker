import request from 'supertest';
import { insertPrice } from '../src/repositories/prices';
import { AUTH, makeContext, type TestContext } from './helpers';

describe('пагинация (limit/offset + X-Total-Count)', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  async function seedCoins(n: number): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const res = await request(ctx.app)
        .post('/api/coins')
        .set('Authorization', AUTH)
        .send({ symbol: `S${i}`, name: `Coin ${i}` });
      ids.push(res.body.id as number);
    }
    return ids;
  }

  it('GET /api/coins: limit/offset + X-Total-Count', async () => {
    await seedCoins(5);
    const res = await request(ctx.app)
      .get('/api/coins?limit=2&offset=1')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.headers['x-total-count']).toBe('5');
    expect(res.body.map((c: { symbol: string }) => c.symbol)).toEqual(['S1', 'S2']);
  });

  it('GET /api/coins: отрицательный offset -> 400', async () => {
    const res = await request(ctx.app).get('/api/coins?offset=-1').set('Authorization', AUTH);
    expect(res.status).toBe(400);
  });

  it('GET /api/coins: limit=0 -> 400', async () => {
    const res = await request(ctx.app).get('/api/coins?limit=0').set('Authorization', AUTH);
    expect(res.status).toBe(400);
  });

  it('GET /api/prices/latest: limit/offset + X-Total-Count', async () => {
    await seedCoins(4);
    const res = await request(ctx.app)
      .get('/api/prices/latest?limit=2&offset=1')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.headers['x-total-count']).toBe('4');
    expect(res.body.map((p: { symbol: string }) => p.symbol)).toEqual(['S1', 'S2']);
  });

  it('GET /api/coins/:id/prices: offset + X-Total-Count', async () => {
    const [id] = await seedCoins(1);
    const points: Array<[number, string]> = [
      [10, '2026-01-01T10:00:00Z'],
      [20, '2026-01-01T11:00:00Z'],
      [30, '2026-01-01T12:00:00Z']
    ];
    for (const [price, at] of points) insertPrice(ctx.db, id!, price, 'USD', at);

    // история отсортирована по fetched_at DESC: 30, 20, 10
    const res = await request(ctx.app)
      .get(`/api/coins/${id}/prices?limit=1&offset=1`)
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.headers['x-total-count']).toBe('3');
    expect(res.body.map((p: { price: number }) => p.price)).toEqual([20]);
  });

  it('GET /api/coins/:id/prices: offset не число -> 400', async () => {
    const [id] = await seedCoins(1);
    const res = await request(ctx.app)
      .get(`/api/coins/${id}/prices?offset=abc`)
      .set('Authorization', AUTH);
    expect(res.status).toBe(400);
  });
});
