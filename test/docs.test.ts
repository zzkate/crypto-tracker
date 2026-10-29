import request from 'supertest';
import { makeContext, type TestContext } from './helpers';

describe('system endpoints', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  it('GET /health возвращает 200', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('POST /health возвращает 404 (метод не поддерживается)', async () => {
    const res = await request(ctx.app).post('/health');
    expect(res.status).toBe(404);
  });

  it('GET /openapi.json отдаёт OpenAPI 3.0', async () => {
    const res = await request(ctx.app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.0\./);
    expect(res.body.paths['/api/coins']).toBeDefined();
  });

  it('POST /openapi.json возвращает 404', async () => {
    const res = await request(ctx.app).post('/openapi.json');
    expect(res.status).toBe(404);
  });

  it('GET /docs отдаёт Swagger UI', async () => {
    const res = await request(ctx.app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('неизвестный маршрут возвращает 404', async () => {
    const res = await request(ctx.app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});
