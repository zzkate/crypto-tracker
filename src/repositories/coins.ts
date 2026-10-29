import { prepare, type Db } from '../db';

export interface Coin {
  id: number;
  symbol: string;
  name: string;
  priceCurrency: string;
  lastUpdatedAt: string | null;
  createdAt: string;
}

interface CoinRow {
  id: number;
  symbol: string;
  name: string;
  price_currency: string;
  last_updated_at: string | null;
  created_at: string;
}

function toCoin(row: CoinRow): Coin {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    priceCurrency: row.price_currency,
    lastUpdatedAt: row.last_updated_at,
    createdAt: row.created_at
  };
}

export function createCoin(
  db: Db,
  input: { symbol: string; name: string; priceCurrency: string; createdAt: string }
): Coin {
  const info = prepare(
    db,
    'INSERT INTO coins (symbol, name, price_currency, created_at) VALUES (?, ?, ?, ?)'
  ).run(input.symbol, input.name, input.priceCurrency, input.createdAt);

  const coin = getCoin(db, Number(info.lastInsertRowid));
  if (!coin) {
    throw new Error('failed to read back created coin');
  }
  return coin;
}

export function listCoins(db: Db, pagination?: { limit: number; offset: number }): Coin[] {
  if (pagination) {
    const rows = prepare(db, 'SELECT * FROM coins ORDER BY id ASC LIMIT ? OFFSET ?').all(
      pagination.limit,
      pagination.offset
    ) as unknown as CoinRow[];
    return rows.map(toCoin);
  }
  const rows = prepare(db, 'SELECT * FROM coins ORDER BY id ASC').all() as unknown as CoinRow[];
  return rows.map(toCoin);
}

export function countCoins(db: Db): number {
  return (prepare(db, 'SELECT COUNT(*) AS n FROM coins').get() as { n: number }).n;
}

export function getCoin(db: Db, id: number): Coin | null {
  const row = prepare(db, 'SELECT * FROM coins WHERE id = ?').get(id) as unknown as CoinRow | undefined;
  return row ? toCoin(row) : null;
}

export function findCoinBySymbol(db: Db, symbol: string): Coin | null {
  const row = prepare(db, 'SELECT * FROM coins WHERE symbol = ?').get(symbol) as unknown as
    | CoinRow
    | undefined;
  return row ? toCoin(row) : null;
}

export function updateCoin(
  db: Db,
  id: number,
  patch: { symbol?: string; name?: string }
): Coin | null {
  const current = getCoin(db, id);
  if (!current) return null;

  prepare(db, 'UPDATE coins SET symbol = ?, name = ? WHERE id = ?').run(
    patch.symbol ?? current.symbol,
    patch.name ?? current.name,
    id
  );
  return getCoin(db, id);
}

export function deleteCoin(db: Db, id: number): boolean {
  const info = prepare(db, 'DELETE FROM coins WHERE id = ?').run(id);
  return Number(info.changes) > 0;
}

export function touchCoin(db: Db, id: number, updatedAt: string): void {
  prepare(db, 'UPDATE coins SET last_updated_at = ? WHERE id = ?').run(updatedAt, id);
}
