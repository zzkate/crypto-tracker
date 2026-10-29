import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type Db = DatabaseSync;

// Кэш prepared statements по соединению. WeakMap не держит соединение живым:
// после db.close() записи уходят из памяти вместе с соединением.
const statementCache = new WeakMap<Db, Map<string, StatementSync>>();

/** Возвращает закэшированный prepared statement для данного соединения. */
export function prepare(db: Db, sql: string): StatementSync {
  let byDb = statementCache.get(db);
  if (!byDb) {
    byDb = new Map();
    statementCache.set(db, byDb);
  }
  let stmt = byDb.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    byDb.set(sql, stmt);
  }
  return stmt;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS coins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_currency TEXT NOT NULL,
  last_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_id INTEGER NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (coin_id) REFERENCES coins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_price_history_coin_time
  ON price_history(coin_id, fetched_at DESC, id DESC);
`;

/** Открывает SQLite и создаёт схему. Для тестов поддерживается ':memory:'. */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /UNIQUE constraint failed/i.test(message);
}
