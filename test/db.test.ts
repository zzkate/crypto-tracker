import { openDb, prepare } from '../src/db';

describe('statement cache', () => {
  it('возвращает один и тот же statement для одного SQL на одном соединении', () => {
    const db = openDb(':memory:');
    const first = prepare(db, 'SELECT * FROM coins');
    const second = prepare(db, 'SELECT * FROM coins');
    expect(first).toBe(second);

    const other = prepare(db, 'SELECT * FROM price_history');
    expect(other).not.toBe(first);

    db.close();
  });

  it('не смешивает statements между соединениями', () => {
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');

    const s1 = prepare(db1, 'SELECT * FROM coins');
    const s2 = prepare(db2, 'SELECT * FROM coins');
    expect(s1).not.toBe(s2);

    db1.close();
    db2.close();
  });

  it('закэшированный statement корректно выполняет запросы', () => {
    const db = openDb(':memory:');
    prepare(db, "INSERT INTO coins (symbol, name, price_currency, created_at) VALUES (?, ?, ?, ?)").run(
      'BTC',
      'Bitcoin',
      'USD',
      new Date().toISOString()
    );

    const rows = prepare(db, 'SELECT * FROM coins').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: 'BTC' });

    db.close();
  });
});
