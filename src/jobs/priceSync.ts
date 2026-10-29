import type { PriceSyncService } from '../services/sync';

type SyncRunner = Pick<PriceSyncService, 'syncOnce'>;

export interface SyncJobLogger {
  error(...args: unknown[]): void;
}

export interface SyncJob {
  stop(): void;
  runNow(): Promise<void>;
}

export interface StartPriceSyncOptions {
  sync: SyncRunner;
  intervalMs: number;
  logger?: SyncJobLogger;
}

/**
 * Запускает синхронизацию сразу и далее с заданным интервалом.
 * Повторный запуск не стартует, пока предыдущий не завершился.
 * stop() гарантированно прекращает будущие запуски (graceful shutdown).
 */
export function startPriceSync(options: StartPriceSyncOptions): SyncJob {
  const logger = options.logger ?? console;
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  const run = async (): Promise<void> => {
    if (stopped || running) return;

    running = true;
    try {
      await options.sync.syncOnce();
    } catch (error) {
      logger.error(
        '[price-sync] synchronization failed:',
        error instanceof Error ? error.message : error
      );
    } finally {
      running = false;
    }
  };

  void run();
  timer = setInterval(() => {
    void run();
  }, options.intervalMs);
  timer.unref?.();

  return {
    stop(): void {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    runNow: run
  };
}
