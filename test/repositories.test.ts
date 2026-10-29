import { openDb } from '../src/db';
import { createCoin } from '../src/repositories/coins';
import { insertPrice, listLatestPrices } from '../src/repositories/prices';

function addCoin(db: ReturnType<typeof openDb>, symbol: string, name: string): number {
  return createCoin(db, {
    symbol,
    name,
    priceCurrency: 'USD',
    createdAt: '2026-01-01T00:00:00.000Z'
  }).id;
}

describe('listLatestPrices (оптимизированный запрос)', () => {
  it('возвращает последнюю цену каждой монеты, без истории — null', () => {
    const db = openDb(':memory:');
    const btc = addCoin(db, 'BTC', 'Bitcoin');
    const eth = addCoin(db, 'ETH', 'Ethereum');
    const sol = addCoin(db, 'SOL', 'Solana');

    insertPrice(db, btc, 100, 'USD', '2026-01-01T10:00:00.000Z');
    insertPrice(db, btc, 110, 'USD', '2026-01-01T11:00:00.000Z'); // последняя BTC
    insertPrice(db, eth, 200, 'USD', '2026-01-01T10:00:00.000Z'); // единственная ETH

    expect(listLatestPrices(db)).toEqual([
      {
        coinId: btc,
        symbol: 'BTC',
        name: 'Bitcoin',
        price: 110,
        currency: 'USD',
        fetchedAt: '2026-01-01T11:00:00.000Z'
      },
      {
        coinId: eth,
        symbol: 'ETH',
        name: 'Ethereum',
        price: 200,
        currency: 'USD',
        fetchedAt: '2026-01-01T10:00:00.000Z'
      },
      {
        coinId: sol,
        symbol: 'SOL',
        name: 'Solana',
        price: null,
        currency: 'USD',
        fetchedAt: null
      }
    ]);

    db.close();
  });

  it('при одинаковом fetched_at берёт строку с большим id', () => {
    const db = openDb(':memory:');
    const btc = addCoin(db, 'BTC', 'Bitcoin');

    insertPrice(db, btc, 100, 'USD', '2026-01-01T10:00:00.000Z');
    insertPrice(db, btc, 111, 'USD', '2026-01-01T10:00:00.000Z');

    const latest = listLatestPrices(db);
    expect(latest[0]?.price).toBe(111);

    db.close();
  });

  it('берёт строку с максимальным fetched_at, даже если она вставлена не последней', () => {
    const db = openDb(':memory:');
    const btc = addCoin(db, 'BTC', 'Bitcoin');

    // Вставка вразнобой: самая поздняя fetched_at — НЕ последний id.
    insertPrice(db, btc, 100, 'USD', '2026-01-01T10:00:00.000Z');
    insertPrice(db, btc, 150, 'USD', '2026-01-03T10:00:00.000Z');
    insertPrice(db, btc, 120, 'USD', '2026-01-02T10:00:00.000Z');

    const latest = listLatestPrices(db);
    expect(latest[0]?.price).toBe(150);
    expect(latest[0]?.fetchedAt).toBe('2026-01-03T10:00:00.000Z');

    db.close();
  });

  it('пустая БД — пустой результат', () => {
    const db = openDb(':memory:');
    expect(listLatestPrices(db)).toEqual([]);
    db.close();
  });
});
