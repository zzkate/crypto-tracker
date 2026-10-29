// Нагрузочный прогон на стандартных возможностях Node (fetch), без внешних пакетов.
// Переменные окружения:
//   BASE_URL          — базовый URL (по умолчанию http://127.0.0.1:3000)
//   APP_API_KEY       — Bearer-токен (обязателен)
//   CONCURRENCY       — одновременных запросов (по умолчанию 50)
//   DURATION_SECONDS  — длительность, сек (по умолчанию 10)
//   ENDPOINT          — путь (по умолчанию /api/coins)
import { performance } from 'node:perf_hooks';

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const apiKey = process.env.APP_API_KEY;
const concurrency = Number(process.env.CONCURRENCY || 50);
const durationMs = Number(process.env.DURATION_SECONDS || 10) * 1000;
const endpoint = process.env.ENDPOINT || '/api/coins';

if (!apiKey) {
  console.error('APP_API_KEY is required');
  process.exit(1);
}
if (!Number.isInteger(concurrency) || concurrency <= 0) {
  console.error('CONCURRENCY must be a positive integer');
  process.exit(1);
}

const url = `${base}${endpoint}`;
const latencies = [];
let ok = 0;
let errors = 0;

async function oneRequest() {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    latencies.push(performance.now() - start);
    if (res.status >= 200 && res.status < 400) ok += 1;
    else errors += 1;
    await res.text();
  } catch {
    errors += 1;
  }
}

const deadline = Date.now() + durationMs;
const workers = Array.from({ length: concurrency }, async () => {
  while (Date.now() < deadline) {
    await oneRequest();
  }
});

await Promise.all(workers);

const total = ok + errors;
latencies.sort((a, b) => a - b);
const round = (n) => Math.round(n * 100) / 100;
const pct = (q) => (latencies.length ? round(latencies[Math.floor(q * (latencies.length - 1))]) : 0);

console.log(
  JSON.stringify(
    {
      endpoint: url,
      concurrency,
      durationMs,
      totalRequests: total,
      rps: total ? round(total / (durationMs / 1000)) : 0,
      ok,
      errors,
      errorRatePct: total ? round((errors / total) * 100) : 0,
      latencyMs: {
        min: latencies.length ? round(latencies[0]) : 0,
        p50: pct(0.5),
        p95: pct(0.95),
        p99: pct(0.99),
        max: latencies.length ? round(latencies[latencies.length - 1]) : 0
      }
    },
    null,
    2
  )
);
