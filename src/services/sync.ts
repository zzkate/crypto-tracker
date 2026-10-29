import type { Db } from '../db';
import { listCoins, touchCoin } from '../repositories/coins';
import { insertPrice } from '../repositories/prices';
import type { CmcClient } from './coinmarketcap';

export interface SyncResult {
  updated: number;
  skipped: number;
}

export interface SyncOptions {
  /** Сколько символов отправлять в одном запросе к CMC. */
  batchSize?: number;
  /** Сколько раз повторить запрос при ошибке (не считая первую попытку). */
  maxRetries?: number;
  /** База задержки между повторами (мс), растёт экспоненциально. */
  retryBackoffMs?: number;
}

/**
 * Ретраим только ошибки, которые имеют смысл повторять:
 * сеть/таймаут (нет HTTP-ответа), 429 (rate limit) и 5xx.
 * 4xx (401/403/404…) повторять бессмысленно.
 */
export function isRetryableError(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | undefined)?.response?.status;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

export class PriceSyncService {
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private inFlight: Promise<SyncResult> | null = null;

  constructor(
    private readonly db: Db,
    private readonly client: CmcClient,
    private readonly currency: string,
    options: SyncOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.maxRetries = options.maxRetries ?? 0;
    this.retryBackoffMs = options.retryBackoffMs ?? 200;
  }

  /**
   * Забирает цены всех отслеживаемых монет и сохраняет их в историю.
   * Параллельные вызовы объединяются в один запрос (coalescing), чтобы
   * не тратить лишние кредиты CMC и не гонять параллельные записи.
   * При ошибке внешнего API выбрасывает исключение; частичных записей нет.
   */
  syncOnce(now: Date = new Date()): Promise<SyncResult> {
    if (!this.inFlight) {
      this.inFlight = this.run(now).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async run(now: Date): Promise<SyncResult> {
    const coins = listCoins(this.db);
    if (coins.length === 0) {
      return { updated: 0, skipped: 0 };
    }

    const prices = new Map<string, number>();
    for (let i = 0; i < coins.length; i += this.batchSize) {
      const symbols = coins
        .slice(i, i + this.batchSize)
        .map((coin) => coin.symbol);
      const chunk = await this.fetchWithRetry(symbols);
      for (const [symbol, price] of chunk) {
        prices.set(symbol, price);
      }
    }

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

  private async fetchWithRetry(symbols: string[]): Promise<Map<string, number>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.client.fetchPrices(symbols, this.currency);
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries && isRetryableError(error)) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryBackoffMs * 2 ** attempt)
          );
          continue;
        }
        break;
      }
    }
    throw lastError;
  }
}
