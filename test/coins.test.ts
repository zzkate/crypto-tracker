import request from 'supertest';
import { AUTH, makeContext, type TestContext } from './helpers';

describe('coins CRUD', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  const create = (body: object) =>
    request(ctx.app).post('/api/coins').set('Authorization', AUTH).send(body);

  it('создаёт монету (201)', async () => {
    const res = await create({ symbol: 'btc', name: 'Bitcoin' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      symbol: 'BTC',
      name: 'Bitcoin',
      priceCurrency: 'USD',
      lastUpdatedAt: null
    });
    expect(res.body.id).toBeGreaterThan(0);
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('отклоняет дубликат символа (409)', async () => {
    await create({ symbol: 'BTC', name: 'Bitcoin' });
    const res = await create({ symbol: 'BTC', name: 'Bitcoin duplicate' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conflict');
  });

  it('отклоняет невалидный символ (400)', async () => {
    const res = await create({ symbol: 'b', name: 'Bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('отклоняет отсутствие name (400)', async () => {
    const res = await create({ symbol: 'ETH' });
    expect(res.status).toBe(400);
  });

  it('отклоняет невалидный JSON (400)', async () => {
    const res = await request(ctx.app)
      .post('/api/coins')
      .set('Authorization', AUTH)
      .set('Content-Type', 'application/json')
      .send('{"symbol":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_json');
  });

  it('возвращает список монет', async () => {
    await create({ symbol: 'BTC', name: 'Bitcoin' });
    await create({ symbol: 'ETH', name: 'Ethereum' });

    const res = await request(ctx.app).get('/api/coins').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((c: { symbol: string }) => c.symbol)).toEqual(['BTC', 'ETH']);
  });

  it('возвращает монету по id', async () => {
    const created = await create({ symbol: 'SOL', name: 'Solana' });
    const res = await request(ctx.app)
      .get(`/api/coins/${created.body.id}`)
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('SOL');
  });

  it('возвращает 404 для несуществующей монеты', async () => {
    const res = await request(ctx.app).get('/api/coins/9999').set('Authorization', AUTH);
    expect(res.status).toBe(404);
  });

  it('возвращает 400 для невалидного id', async () => {
    const res = await request(ctx.app).get('/api/coins/abc').set('Authorization', AUTH);
    expect(res.status).toBe(400);
  });

  it('обновляет монету (PATCH)', async () => {
    const created = await create({ symbol: 'ADA', name: 'Cardano' });
    const res = await request(ctx.app)
      .patch(`/api/coins/${created.body.id}`)
      .set('Authorization', AUTH)
      .send({ name: 'Cardano updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Cardano updated');
    expect(res.body.symbol).toBe('ADA');
  });

  it('отклоняет пустой PATCH (400)', async () => {
    const created = await create({ symbol: 'ADA', name: 'Cardano' });
    const res = await request(ctx.app)
      .patch(`/api/coins/${created.body.id}`)
      .set('Authorization', AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  it('возвращает 404 при PATCH несуществующей монеты', async () => {
    const res = await request(ctx.app)
      .patch('/api/coins/9999')
      .set('Authorization', AUTH)
      .send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('возвращает 409 при PATCH на занятый символ', async () => {
    await create({ symbol: 'BTC', name: 'Bitcoin' });
    const eth = await create({ symbol: 'ETH', name: 'Ethereum' });

    const res = await request(ctx.app)
      .patch(`/api/coins/${eth.body.id}`)
      .set('Authorization', AUTH)
      .send({ symbol: 'BTC' });
    expect(res.status).toBe(409);
  });

  it('удаляет монету (204) и затем отдаёт 404', async () => {
    const created = await create({ symbol: 'XRP', name: 'Ripple' });

    const del = await request(ctx.app)
      .delete(`/api/coins/${created.body.id}`)
      .set('Authorization', AUTH);
    expect(del.status).toBe(204);

    const get = await request(ctx.app)
      .get(`/api/coins/${created.body.id}`)
      .set('Authorization', AUTH);
    expect(get.status).toBe(404);
  });

  it('возвращает 404 при удалении несуществующей монеты', async () => {
    const res = await request(ctx.app).delete('/api/coins/9999').set('Authorization', AUTH);
    expect(res.status).toBe(404);
  });
});
