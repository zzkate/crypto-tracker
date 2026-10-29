import request from 'supertest';
import { AUTH, makeContext, type TestContext } from './helpers';

describe('устойчивость: поломка кода и SQL-инъекции', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  const post = (body: unknown) =>
    request(ctx.app).post('/api/coins').set('Authorization', AUTH).send(body as object);

  it('хранит SQL-инъекцию в name как обычную строку, таблица цела', async () => {
    const payload = "x'; DROP TABLE coins;--";
    const res = await post({ symbol: 'BTC', name: payload });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(payload);

    const coins = await request(ctx.app).get('/api/coins').set('Authorization', AUTH);
    expect(coins.status).toBe(200);
    expect(coins.body).toHaveLength(1);

    // таблица coins жива — запрос истории не падает с «нет такой таблицы»
    const history = await request(ctx.app).get('/api/coins/1/prices').set('Authorization', AUTH);
    expect(history.status).toBe(200);
  });

  it('отклоняет SQL-инъекцию в symbol', async () => {
    for (const symbol of ["'; DROP TABLE coins;--", "' OR '1'='1", 'BTC;--', 'BTC OR 1=1']) {
      const res = await post({ symbol, name: 'x' });
      expect(res.status).toBe(400);
    }
  });

  it('отклоняет SQL-инъекцию в id', async () => {
    const res = await request(ctx.app)
      .get('/api/coins/1%20OR%201=1')
      .set('Authorization', AUTH);
    expect(res.status).toBe(400);
  });

  it('отклоняет SQL-инъекцию в параметрах limit/from', async () => {
    await post({ symbol: 'BTC', name: 'Bitcoin' });

    const limit = await request(ctx.app)
      .get('/api/coins/1/prices?limit=1%20OR%201=1')
      .set('Authorization', AUTH);
    expect(limit.status).toBe(400);

    const from = await request(ctx.app)
      .get("/api/coins/1/prices?from=1%27%20OR%20%271%27%3D%271")
      .set('Authorization', AUTH);
    expect(from.status).toBe(400);
  });

  it('отклоняет слишком большое тело (413)', async () => {
    const res = await post({ symbol: 'BTC', name: 'A'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('payload_too_large');
  });

  it('отклоняет не-объектное тело', async () => {
    for (const body of ['42', '"string"', 'null', '["BTC"]', 'true']) {
      const res = await request(ctx.app)
        .post('/api/coins')
        .set('Authorization', AUTH)
        .set('Content-Type', 'application/json')
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('границы symbol: 1 символ -> 400, 11 -> 400, 2 и 10 -> 201', async () => {
    expect((await post({ symbol: 'A', name: 'x' })).status).toBe(400);
    expect((await post({ symbol: 'ABCDEFGHIJK', name: 'x' })).status).toBe(400);
    expect((await post({ symbol: 'AB', name: 'x' })).status).toBe(201);
    expect((await post({ symbol: 'ABCDEFGHIJ', name: 'x' })).status).toBe(201);
  });

  it('name с кавычками и спецсимволами хранится как есть', async () => {
    const name = `it's "quoted" ; -- <script>alert(1)</script>`;
    const res = await post({ symbol: 'BTC', name });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
  });

  it('параллельный POST с одинаковым символом: один 201, второй 409', async () => {
    const [a, b] = await Promise.all([
      post({ symbol: 'BTC', name: 'Bitcoin' }),
      post({ symbol: 'BTC', name: 'Bitcoin' })
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('тело не в формате JSON -> 400', async () => {
    const res = await request(ctx.app)
      .post('/api/coins')
      .set('Authorization', AUTH)
      .set('Content-Type', 'text/plain')
      .send('symbol=BTC');
    expect(res.status).toBe(400);
  });
});
