import request from 'supertest';
import { insertPrice } from '../src/repositories/prices';
import { AUTH, makeContext, type TestContext } from './helpers';

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';

describe('prices', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  async function seedCoin(symbol = 'BTC', name = 'Bitcoin'): Promise<number> {
    const res = await request(ctx.app)
      .post('/api/coins')
      .set('Authorization', AUTH)
      .send({ symbol, name });
    return res.body.id as number;
  }

  function get(path: string) {
    return request(ctx.app).get(path).set('Authorization', AUTH);
  }

  it('до синхронизации отдаёт null-цену в /api/prices/latest', async () => {
    await seedCoin();
    const res = await get('/api/prices/latest');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        coinId: 1,
        symbol: 'BTC',
        name: 'Bitcoin',
        price: null,
        currency: 'USD',
        fetchedAt: null
      }
    ]);
  });

  it('отдаёт актуальные цены после появления истории', async () => {
    const id = await seedCoin();
    insertPrice(ctx.db, id, 100, 'USD', T1);
    insertPrice(ctx.db, id, 150, 'USD', T3);
    insertPrice(ctx.db, id, 120, 'USD', T2);

    const res = await get('/api/prices/latest');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ coinId: id, price: 150, fetchedAt: T3 });
  });

  it('возвращает историю цен (сначала новые)', async () => {
    const id = await seedCoin();
    insertPrice(ctx.db, id, 100, 'USD', T1);
    insertPrice(ctx.db, id, 150, 'USD', T3);
    insertPrice(ctx.db, id, 120, 'USD', T2);

    const res = await get(`/api/coins/${id}/prices`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { price: number }) => p.price)).toEqual([150, 120, 100]);
  });

  it('фильтрует историю по from/to и limit', async () => {
    const id = await seedCoin();
    insertPrice(ctx.db, id, 100, 'USD', T1);
    insertPrice(ctx.db, id, 150, 'USD', T3);
    insertPrice(ctx.db, id, 120, 'USD', T2);

    const from = await get(`/api/coins/${id}/prices?from=${T2}`);
    expect(from.body.map((p: { price: number }) => p.price)).toEqual([150, 120]);

    const to = await get(`/api/coins/${id}/prices?to=${T1}`);
    expect(to.body.map((p: { price: number }) => p.price)).toEqual([100]);

    const limit = await get(`/api/coins/${id}/prices?limit=1`);
    expect(limit.body.map((p: { price: number }) => p.price)).toEqual([150]);
  });

  it('отклоняет невалидный limit (400)', async () => {
    const id = await seedCoin();
    const res = await get(`/api/coins/${id}/prices?limit=0`);
    expect(res.status).toBe(400);
  });

  it('отклоняет невалидную дату (400)', async () => {
    const id = await seedCoin();
    const res = await get(`/api/coins/${id}/prices?from=not-a-date`);
    expect(res.status).toBe(400);
  });

  it('отклоняет from > to (400)', async () => {
    const id = await seedCoin();
    const res = await get(`/api/coins/${id}/prices?from=${T3}&to=${T1}`);
    expect(res.status).toBe(400);
  });

  it('возвращает 404 для истории несуществующей монеты', async () => {
    const res = await get('/api/coins/9999/prices');
    expect(res.status).toBe(404);
  });

  it('возвращает 400 для невалидного id в истории', async () => {
    const res = await get('/api/coins/abc/prices');
    expect(res.status).toBe(400);
  });

  it('возвращает последнюю цену монеты', async () => {
    const id = await seedCoin();
    insertPrice(ctx.db, id, 100, 'USD', T1);
    insertPrice(ctx.db, id, 150, 'USD', T3);

    const res = await get(`/api/coins/${id}/prices/latest`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ coinId: id, price: 150, currency: 'USD' });
  });

  it('возвращает 404, если цены ещё нет', async () => {
    const id = await seedCoin();
    const res = await get(`/api/coins/${id}/prices/latest`);
    expect(res.status).toBe(404);
  });

  it('возвращает 404 для последней цены несуществующей монеты', async () => {
    const res = await get('/api/coins/9999/prices/latest');
    expect(res.status).toBe(404);
  });
});
