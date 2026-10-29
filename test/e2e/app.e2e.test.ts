import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const APP_API_KEY = 'e2e-app-key';
const CMC_API_KEY = 'e2e-cmc-key';

type CmcMode = 'ok' | 'error' | 'slow';

let cmcMode: CmcMode = 'ok';
let cmcServer: http.Server;
let app: ChildProcess | undefined;
let baseUrl = '';
let tmpDir = '';
let logs = '';
let btcId = 0;
let ethId = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function cmcPayload(symbols: string[], convert: string): string {
  const data: Record<string, unknown> = {};
  for (const symbol of symbols) {
    const price = symbol === 'BTC' ? 50000 : symbol === 'ETH' ? 3000 : 1;
    data[symbol] = { quote: { [convert]: { price } } };
  }
  return JSON.stringify({ data });
}

async function startCmcMock(port: number): Promise<void> {
  cmcServer = http.createServer((req, res) => {
    if (!req.url?.startsWith('/v1/cryptocurrency/quotes/latest')) {
      res.writeHead(404).end();
      return;
    }

    if (cmcMode === 'error') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: { error_code: 500 } }));
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const symbols = (url.searchParams.get('symbol') ?? '').split(',').filter(Boolean);
    const convert = url.searchParams.get('convert') ?? 'USD';

    const send = (): void => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(cmcPayload(symbols, convert));
    };

    if (cmcMode === 'slow') {
      const timer = setTimeout(send, 1000);
      timer.unref();
      return;
    }
    send();
  });

  await new Promise<void>((resolve) => cmcServer.listen(port, '127.0.0.1', () => resolve()));
}

async function waitForHealth(url: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // сервер ещё не слушает
    }
    await sleep(100);
  }
  throw new Error(`server did not become healthy:\n${logs}`);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${APP_API_KEY}`, ...extra };
}

async function api(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...headers(),
      ...((init.headers as Record<string, string> | undefined) ?? {})
    }
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface LatestPrice {
  symbol: string;
  price: number | null;
}

async function waitForPrices(count: number, timeoutMs = 6000): Promise<LatestPrice[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api('/api/prices/latest');
    if (res.ok) {
      const data = await json<LatestPrice[]>(res);
      if (
        data.length >= count &&
        data.every((p) => typeof p.price === 'number' && p.price > 0)
      ) {
        return data;
      }
    }
    await sleep(100);
  }
  throw new Error(`prices did not appear:\n${logs}`);
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-e2e-'));
  const dbPath = path.join(tmpDir, 'e2e.db');

  const cmcPort = await freePort();
  await startCmcMock(cmcPort);

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;

  app = spawn(process.execPath, ['dist/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      APP_API_KEY,
      CMC_API_KEY,
      CMC_BASE_URL: `http://127.0.0.1:${cmcPort}`,
      CMC_TIMEOUT_MS: '300',
      SYNC_INTERVAL_MS: '1000',
      PRICE_CURRENCY: 'USD',
      DB_PATH: dbPath,
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  app.stdout?.on('data', (chunk) => {
    logs += chunk.toString();
  });
  app.stderr?.on('data', (chunk) => {
    logs += chunk.toString();
  });

  await waitForHealth(baseUrl);
}, 30000);

afterAll(async () => {
  if (app && app.exitCode === null) {
    app.kill('SIGKILL');
    await new Promise<void>((resolve) => app?.once('exit', () => resolve()));
  }
  if (cmcServer) {
    await new Promise<void>((resolve) => {
      cmcServer.close(() => resolve());
      cmcServer.closeAllConnections?.();
    });
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('E2E: crypto tracker', () => {
  test('health доступен без авторизации', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ status: 'ok' });
  });

  test('API без токена отдаёт 401', async () => {
    const res = await fetch(`${baseUrl}/api/coins`);
    expect(res.status).toBe(401);
  });

  test('создаёт BTC и ETH, дубликат отклоняет', async () => {
    const btc = await api('/api/coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTC', name: 'Bitcoin' })
    });
    expect(btc.status).toBe(201);
    btcId = (await json<{ id: number }>(btc)).id;

    const eth = await api('/api/coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'ETH', name: 'Ethereum' })
    });
    expect(eth.status).toBe(201);
    ethId = (await json<{ id: number }>(eth)).id;

    const duplicate = await api('/api/coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTC', name: 'Bitcoin again' })
    });
    expect(duplicate.status).toBe(409);
  });

  test('фоновая синхронизация получает цены из CMC', async () => {
    const prices = await waitForPrices(2);
    expect(prices.map((p) => p.symbol).sort()).toEqual(['BTC', 'ETH']);
    expect(prices.find((p) => p.symbol === 'BTC')?.price).toBe(50000);
    expect(prices.find((p) => p.symbol === 'ETH')?.price).toBe(3000);
  });

  test('история цен доступна', async () => {
    const res = await api(`/api/coins/${btcId}/prices`);
    expect(res.status).toBe(200);
    const history = await json<Array<{ price: number }>>(res);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]?.price).toBe(50000);
  });

  test('ручная синхронизация возвращает updated', async () => {
    const res = await api('/api/sync', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await json<{ updated: number; skipped: number }>(res)).toEqual({
      updated: 2,
      skipped: 0
    });
  });

  test('PATCH: no-op и реальное изменение', async () => {
    const noop = await api(`/api/coins/${btcId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTC', name: 'Bitcoin' })
    });
    expect(noop.status).toBe(200);
    expect(noop.headers.get('x-changed')).toBe('false');

    const changed = await api(`/api/coins/${btcId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bitcoin updated' })
    });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('x-changed')).toBe('true');
    expect((await json<{ name: string }>(changed)).name).toBe('Bitcoin updated');
  });

  test('ошибка CMC: sync -> 502, данные не теряются', async () => {
    cmcMode = 'error';
    try {
      const res = await api('/api/sync', { method: 'POST' });
      expect(res.status).toBe(502);

      const prices = await json<LatestPrice[]>(await api('/api/prices/latest'));
      expect(prices.length).toBeGreaterThan(0);
      expect(prices.every((p) => typeof p.price === 'number')).toBe(true);
    } finally {
      cmcMode = 'ok';
    }
  });

  test('таймаут CMC: sync -> 502', async () => {
    cmcMode = 'slow';
    try {
      const res = await api('/api/sync', { method: 'POST' });
      expect(res.status).toBe(502);
    } finally {
      cmcMode = 'ok';
    }
  });

  test('удаление монеты удаляет её историю', async () => {
    const del = await api(`/api/coins/${ethId}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const get = await api(`/api/coins/${ethId}`);
    expect(get.status).toBe(404);

    const history = await api(`/api/coins/${ethId}/prices`);
    expect(history.status).toBe(404);
  });

  test('SIGTERM корректно останавливает сервер', async () => {
    expect(app).toBeDefined();
    app?.kill('SIGTERM');
    const code = await new Promise<number | null>((resolve) => {
      app?.once('exit', (exitCode) => resolve(exitCode));
    });
    expect(code).toBe(0);
  });
});
