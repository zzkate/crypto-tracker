// Нагрузочный прогон на стандартных возможностях Node (fetch), без внешних пакетов.
//
// Режимы (MODE):
//   single — один прогон с фиксированной конкурентностью (по умолчанию);
//   sweep  — перебор конкурентности от SWEEP_START до SWEEP_END шагом SWEEP_STEP,
//            печатает таблицу и максимум, при котором нет ошибок и p95 в норме.
//
// Переменные окружения:
//   BASE_URL, APP_API_KEY, ENDPOINT, METHOD (GET|POST|...), BODY (JSON с {{n}}),
//   CONCURRENCY, DURATION_SECONDS, MODE,
//   SWEEP_START, SWEEP_END, SWEEP_STEP, SWEEP_DURATION_MS, P95_LIMIT_MS.
import { performance } from 'node:perf_hooks';

const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const apiKey = process.env.APP_API_KEY;
const method = (process.env.METHOD || 'GET').toUpperCase();
const endpoint = process.env.ENDPOINT || '/api/coins';
const bodyTemplate = process.env.BODY || '';
const mode = process.env.MODE || 'single';

if (!apiKey) {
  console.error('APP_API_KEY is required');
  process.exit(1);
}

const url = `${base}${endpoint}`;
let n = 0;
let ok = 0;
let errors = 0;
const latencies = [];

function nextBody() {
  n += 1;
  return bodyTemplate.replaceAll('{{n}}', String(n));
}

async function oneRequest() {
  const start = performance.now();
  const init = { method, headers: { Authorization: `Bearer ${apiKey}` } };
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    init.headers['Content-Type'] = 'application/json';
    if (bodyTemplate) init.body = nextBody();
  }
  try {
    const res = await fetch(url, init);
    latencies.push(performance.now() - start);
    if (res.status >= 200 && res.status < 400) ok += 1;
    else errors += 1;
    await res.text();
  } catch {
    errors += 1;
  }
}

async function burst(concurrency, durationMs) {
  const deadline = Date.now() + durationMs;
  const workers = Array.from({ length: concurrency }, async () => {
    while (Date.now() < deadline) await oneRequest();
  });
  await Promise.all(workers);
}

function summary(durationMs) {
  const total = ok + errors;
  latencies.sort((a, b) => a - b);
  const round = (x) => Math.round(x * 100) / 100;
  const pct = (q) => (latencies.length ? round(latencies[Math.floor(q * (latencies.length - 1))]) : 0);
  return {
    totalRequests: total,
    rps: total ? round(total / (durationMs / 1000)) : 0,
    ok,
    errors,
    errorRatePct: total ? round((errors / total) * 100) : 0,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    min: latencies.length ? round(latencies[0]) : 0,
    max: latencies.length ? round(latencies[latencies.length - 1]) : 0
  };
}

if (mode === 'sweep') {
  const start = Number(process.env.SWEEP_START || 10);
  const end = Number(process.env.SWEEP_END || 300);
  const step = Number(process.env.SWEEP_STEP || 25);
  const durMs = Number(process.env.SWEEP_DURATION_MS || 500);
  const p95Limit = Number(process.env.P95_LIMIT_MS || 500);

  console.log(
    `sweep ${method} ${url}: concurrency ${start}..${end} step ${step}, ${durMs}ms/burst, p95 limit ${p95Limit}ms`
  );

  const rows = [];
  let maxStable = 0;
  for (let c = start; c <= end; c += step) {
    ok = 0;
    errors = 0;
    latencies.length = 0;
    await burst(c, durMs);

    const total = ok + errors;
    latencies.sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.floor(0.95 * (latencies.length - 1))] : 0;
    const stable = errors === 0 && p95 <= p95Limit;
    if (stable) maxStable = c;

    rows.push({
      concurrency: c,
      rps: Math.round(total / (durMs / 1000)),
      errors,
      p95Ms: Math.round(p95 * 100) / 100,
      state: stable ? 'ok' : 'degraded'
    });
  }

  console.table(rows);
  console.log(`max concurrency (0 ошибок, p95 <= ${p95Limit} мс): ${maxStable}`);
} else {
  const concurrency = Number(process.env.CONCURRENCY || 50);
  const durationMs = Number(process.env.DURATION_SECONDS || 10) * 1000;
  ok = 0;
  errors = 0;
  latencies.length = 0;
  await burst(concurrency, durationMs);

  const s = summary(durationMs);
  console.log(
    JSON.stringify(
      { endpoint: url, method, concurrency, durationMs, ...s },
      null,
      2
    )
  );
}
