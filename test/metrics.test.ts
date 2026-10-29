import request from 'supertest';
import { __resetMetricsForTests } from '../src/metrics';
import { AUTH, makeContext, type TestContext } from './helpers';

describe('metrics', () => {
  let ctx: TestContext;

  beforeEach(() => {
    __resetMetricsForTests();
    ctx = makeContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  it('GET /metrics отдаёт Prometheus-формат', async () => {
    const res = await request(ctx.app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    for (const metric of [
      'http_requests_total',
      'http_errors_total',
      'sync_total',
      'sync_failed_total',
      'coins_total',
      'price_points_total'
    ]) {
      expect(res.text).toContain(metric);
    }
  });

  it('считает запросы и ошибки (401)', async () => {
    await request(ctx.app).get('/health');
    await request(ctx.app).get('/api/coins'); // 401

    const res = await request(ctx.app).get('/metrics');
    expect(res.text).toMatch(/http_requests_total \d+/);
    expect(res.text).toMatch(/http_errors_total [1-9]/);
  });

  it('учитывает успешную синхронизацию', async () => {
    await request(ctx.app).post('/api/sync').set('Authorization', AUTH);

    const res = await request(ctx.app).get('/metrics');
    expect(res.text).toMatch(/sync_total 1/);
    expect(res.text).toMatch(/sync_failed_total 0/);
  });

  it('учитывает неудачную синхронизацию', async () => {
    const client = {
      async fetchPrices(): Promise<Map<string, number>> {
        throw new Error('upstream down');
      }
    };
    const failing = makeContext({ client });
    await request(failing.app).post('/api/coins').set('Authorization', AUTH).send({
      symbol: 'BTC',
      name: 'Bitcoin'
    });
    await request(failing.app).post('/api/sync').set('Authorization', AUTH);

    const res = await request(failing.app).get('/metrics');
    expect(res.text).toMatch(/sync_total 1/);
    expect(res.text).toMatch(/sync_failed_total 1/);

    failing.db.close();
  });
});
