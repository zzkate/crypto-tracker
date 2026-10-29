// Микробенчмарки горячих путей на stdlib (performance.now), без сторонних пакетов.
// Запуск: npm run bench
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { openDb } = require('../dist/db.js');
const { createCoin, getCoin, listCoins } = require('../dist/repositories/coins.js');
const { insertPrice, getLatestPrice, listLatestPrices } = require('../dist/repositories/prices.js');
const { PriceSyncService } = require('../dist/services/sync.js');

const ISO = '2026-01-01T00:00:00.000Z';

function fmt(n) {
  return String(n).padStart(11);
}

function bench(name, fn, { minMs = 400, batch = 1000 } = {}) {
  for (let i = 0; i < 10; i += 1) fn(); // разогрев
  let iters = 0;
  const start = performance.now();
  let now = start;
  do {
    for (let i = 0; i < batch; i += 1) fn();
    iters += batch;
    now = performance.now();
  } while (now - start < minMs);
  const ms = now - start;
  const ops = Math.round(iters / (ms / 1000));
  const ns = Math.round((ms * 1e6) / iters);
  console.log(`${name.padEnd(34)} ${fmt(ops)} ops/s   ${fmt(ns)} ns/op`);
}

async function benchAsync(name, fn, { minMs = 400 } = {}) {
  await fn(); // разогрев
  let iters = 0;
  const start = performance.now();
  let now = start;
  do {
    await fn();
    iters += 1;
    now = performance.now();
  } while (now - start < minMs);
  const ms = now - start;
  const ops = Math.round(iters / (ms / 1000));
  const ns = Math.round((ms * 1e6) / iters);
  console.log(`${name.padEnd(34)} ${fmt(ops)} ops/s   ${fmt(ns)} ns/op`);
}

function fillCoins(db, count) {
  for (let i = 0; i < count; i += 1) {
    createCoin(db, { symbol: `S${i}`, name: `Coin ${i}`, priceCurrency: 'USD', createdAt: ISO });
  }
}

console.log('=== Бенчмарки (in-memory SQLite, WAL, prepared-statement cache) ===\n');

// 1. Вставка монеты
{
  const db = openDb(':memory:');
  let n = 0;
  bench('coins.create (INSERT)', () => {
    createCoin(db, { symbol: `I${n++}`, name: 'x', priceCurrency: 'USD', createdAt: ISO });
  });
  db.close();
}

// 2. Список монет (5000 строк)
{
  const db = openDb(':memory:');
  fillCoins(db, 5000);
  bench('coins.list (SELECT 5000 rows)', () => listCoins(db));
  db.close();
}

// 3. Монета по id
{
  const db = openDb(':memory:');
  fillCoins(db, 5000);
  bench('coins.get (SELECT by id)', () => getCoin(db, 2500));
  db.close();
}

// 4. Вставка точки истории
{
  const db = openDb(':memory:');
  const id = createCoin(db, { symbol: 'BTC', name: 'Bitcoin', priceCurrency: 'USD', createdAt: ISO }).id;
  bench('prices.insert (INSERT history)', () => insertPrice(db, id, 123.45, 'USD', ISO));
  db.close();
}

// 5. Последняя цена одной монеты (5000 точек)
{
  const db = openDb(':memory:');
  const id = createCoin(db, { symbol: 'BTC', name: 'Bitcoin', priceCurrency: 'USD', createdAt: ISO }).id;
  for (let i = 0; i < 5000; i += 1) insertPrice(db, id, i, 'USD', ISO);
  bench('prices.latest (1 coin, 5000 rows)', () => getLatestPrice(db, id));
  db.close();
}

// 6. Последние цены всех монет (коррелированный подзапрос)
{
  const db = openDb(':memory:');
  fillCoins(db, 5000);
  for (const c of listCoins(db)) insertPrice(db, c.id, 1, 'USD', ISO);
  bench('prices.latestAll (5000 coins)', () => listLatestPrices(db), { batch: 1, minMs: 400 });
  db.close();
}

// 7. syncOnce с батчингом (100 монет, batch 25)
{
  const db = openDb(':memory:');
  fillCoins(db, 100);
  const client = {
    async fetchPrices(symbols) {
      return new Map(symbols.map((s) => [s, 42]));
    }
  };
  const svc = new PriceSyncService(db, client, 'USD', { batchSize: 25 });
  await benchAsync('sync.syncOnce (100 coins, batch 25)', () => svc.syncOnce());
  db.close();
}
