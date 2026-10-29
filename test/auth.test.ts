import request from 'supertest';
import { AUTH, makeContext, TEST_API_KEY, type TestContext } from './helpers';

describe('authentication', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  it('отклоняет запрос без токена', async () => {
    const res = await request(ctx.app).get('/api/coins');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('отклоняет неверный токен', async () => {
    const res = await request(ctx.app)
      .get('/api/coins')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('принимает корректный Bearer token', async () => {
    const res = await request(ctx.app).get('/api/coins').set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('health доступен без токена', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('защищает /api/prices/latest', async () => {
    const res = await request(ctx.app).get('/api/prices/latest');
    expect(res.status).toBe(401);
  });

  it('docs и openapi доступны без токена', async () => {
    expect((await request(ctx.app).get('/openapi.json')).status).toBe(200);
    expect((await request(ctx.app).get('/docs/')).status).toBe(200);
  });

  it('неверная схема авторизации отклоняется', async () => {
    const res = await request(ctx.app)
      .get('/api/coins')
      .set('Authorization', `Basic ${TEST_API_KEY}`);
    expect(res.status).toBe(401);
  });
});
