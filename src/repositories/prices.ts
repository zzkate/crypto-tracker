import { prepare, type Db } from '../db';

export interface PricePoint {
  id: number;
  coinId: number;
  price: number;
  currency: string;
  fetchedAt: string;
}

export interface LatestPrice {
  coinId: number;
  symbol: string;
  name: string;
  price: number | null;
  currency: string;
  fetchedAt: string | null;
}

interface PriceRow {
  id: number;
  coin_id: number;
  price: number;
  currency: string;
  fetched_at: string;
}

interface LatestRow {
  coin_id: number;
  symbol: string;
  name: string;
  price_currency: string;
  price: number | null;
  currency: string | null;
  fetched_at: string | null;
}

function toPricePoint(row: PriceRow): PricePoint {
  return {
    id: row.id,
    coinId: row.coin_id,
    price: row.price,
    currency: row.currency,
    fetchedAt: row.fetched_at
  };
}

export function insertPrice(
  db: Db,
  coinId: number,
  price: number,
  currency: string,
  fetchedAt: string
): PricePoint {
  const info = prepare(
    db,
    'INSERT INTO price_history (coin_id, price, currency, fetched_at) VALUES (?, ?, ?, ?)'
  ).run(coinId, price, currency, fetchedAt);

  return {
    id: Number(info.lastInsertRowid),
    coinId,
    price,
    currency,
    fetchedAt
  };
}

export function listPrices(
  db: Db,
  coinId: number,
  options: { from?: string; to?: string; limit: number }
): PricePoint[] {
  const clauses = ['coin_id = ?'];
  const params: Array<string | number> = [coinId];

  if (options.from) {
    clauses.push('fetched_at >= ?');
    params.push(options.from);
  }
  if (options.to) {
    clauses.push('fetched_at <= ?');
    params.push(options.to);
  }
  params.push(options.limit);

  const rows = prepare(
    db,
    `SELECT * FROM price_history WHERE ${clauses.join(' AND ')}
     ORDER BY fetched_at DESC, id DESC LIMIT ?`
  ).all(...params) as unknown as PriceRow[];

  return rows.map(toPricePoint);
}

export function getLatestPrice(db: Db, coinId: number): PricePoint | null {
  const row = prepare(
    db,
    'SELECT * FROM price_history WHERE coin_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1'
  ).get(coinId) as unknown as PriceRow | undefined;

  return row ? toPricePoint(row) : null;
}

export function listLatestPrices(db: Db): LatestPrice[] {
  // Каждый подзапрос — это index-seek по (coin_id, fetched_at DESC, id DESC),
  // т.е. уже оптимально: берём первую строку в индексе для монеты.
  // Нельзя заменять на MAX(id): последняя строка определяется по fetched_at,
  // а не по порядку вставки.
  const rows = prepare(
    db,
    `SELECT c.id AS coin_id, c.symbol, c.name, c.price_currency,
            p.price, p.currency, p.fetched_at
     FROM coins c
     LEFT JOIN price_history p ON p.id = (
       SELECT id FROM price_history
       WHERE coin_id = c.id
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1
     )
     ORDER BY c.id ASC`
  ).all() as unknown as LatestRow[];

  return rows.map((row) => ({
    coinId: row.coin_id,
    symbol: row.symbol,
    name: row.name,
    price: row.price,
    currency: row.currency ?? row.price_currency,
    fetchedAt: row.fetched_at
  }));
}
