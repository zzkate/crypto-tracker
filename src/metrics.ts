import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Db } from './db';

// Простые счётчики (Node однопоточен, атомарность приращений не требуется).
let httpRequestsTotal = 0;
let httpErrorsTotal = 0;
let httpDurationMsSum = 0;
let syncTotal = 0;
let syncFailedTotal = 0;
let syncLastSuccessEpoch = 0;

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    httpRequestsTotal += 1;
    if (res.statusCode >= 400) httpErrorsTotal += 1;
    httpDurationMsSum += Number(process.hrtime.bigint() - start) / 1e6;
  });
  next();
}

export function recordSyncSuccess(): void {
  syncTotal += 1;
  syncLastSuccessEpoch = Math.floor(Date.now() / 1000);
}

export function recordSyncFailure(): void {
  syncTotal += 1;
  syncFailedTotal += 1;
}

/** Только для тестов: обнуляет счётчики. */
export function __resetMetricsForTests(): void {
  httpRequestsTotal = 0;
  httpErrorsTotal = 0;
  httpDurationMsSum = 0;
  syncTotal = 0;
  syncFailedTotal = 0;
  syncLastSuccessEpoch = 0;
}

export function metricsHandler(db: Db): RequestHandler {
  return (_req, res) => {
    const coinsTotal = (db.prepare('SELECT COUNT(*) AS n FROM coins').get() as { n: number }).n;
    const pointsTotal = (
      db.prepare('SELECT COUNT(*) AS n FROM price_history').get() as { n: number }
    ).n;
    const avgMs = httpRequestsTotal ? httpDurationMsSum / httpRequestsTotal : 0;

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(
      [
        '# HELP http_requests_total Общее число HTTP-запросов.',
        '# TYPE http_requests_total counter',
        `http_requests_total ${httpRequestsTotal}`,
        '# HELP http_errors_total Число ответов 4xx/5xx.',
        '# TYPE http_errors_total counter',
        `http_errors_total ${httpErrorsTotal}`,
        '# HELP http_request_duration_ms_sum Суммарная длительность запросов, мс.',
        '# TYPE http_request_duration_ms_sum counter',
        `http_request_duration_ms_sum ${httpDurationMsSum.toFixed(2)}`,
        '# HELP http_request_duration_ms_avg Средняя длительность запроса, мс.',
        '# TYPE http_request_duration_ms_avg gauge',
        `http_request_duration_ms_avg ${avgMs.toFixed(2)}`,
        '# HELP sync_total Всего синхронизаций.',
        '# TYPE sync_total counter',
        `sync_total ${syncTotal}`,
        '# HELP sync_failed_total Неудачных синхронизаций.',
        '# TYPE sync_failed_total counter',
        `sync_failed_total ${syncFailedTotal}`,
        '# HELP sync_last_success_epoch Время последней успешной синхронизации (unix).',
        '# TYPE sync_last_success_epoch gauge',
        `sync_last_success_epoch ${syncLastSuccessEpoch}`,
        '# HELP coins_total Отслеживаемых монет.',
        '# TYPE coins_total gauge',
        `coins_total ${coinsTotal}`,
        '# HELP price_points_total Точек в истории цен.',
        '# TYPE price_points_total gauge',
        `price_points_total ${pointsTotal}`
      ].join('\n') + '\n'
    );
  };
}
