import type { Db } from '../db';
import { listCoins, touchCoin } from '../repositories/coins';
import { insertPrice } from '../repositories/prices';
import type { CmcClient } from './coinmarketcap';

export interface SyncResult {
  updated: number;
  skipped: number;
}

export class PriceSyncService {
  constructor(
    private readonly db: Db,
    private readonly client: CmcClient,
    private readonly currency: string
  ) {}

  /**
   * Забирает цены всех отслеживаемых монет и сохраняет их в историю.
   * При ошибке внешнего API выбрасывает исключение; частичных записей нет,
   * потому что сначала выполняется запрос, и только потом запись.
   */
  async syncOnce(now: Date = new Date()): Promise<SyncResult> {
    const coins = listCoins(this.db);
    if (coins.length === 0) {
      return { updated: 0, skipped: 0 };
    }

    const prices = await this.client.fetchPrices(
      coins.map((coin) => coin.symbol),
      this.currency
    );

    const fetchedAt = now.toISOString();
    let updated = 0;
    let skipped = 0;

    for (const coin of coins) {
      const price = prices.get(coin.symbol);
      if (price === undefined) {
        skipped += 1;
        continue;
      }
      insertPrice(this.db, coin.id, price, this.currency, fetchedAt);
      touchCoin(this.db, coin.id, fetchedAt);
      updated += 1;
    }

    return { updated, skipped };
  }
}
