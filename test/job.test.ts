import { startPriceSync } from '../src/jobs/priceSync';
import type { SyncResult } from '../src/services/sync';

function syncMock() {
  return jest.fn<Promise<SyncResult>, []>();
}

describe('background price sync job', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('запускается сразу и затем по интервалу, stop() прекращает запуски', async () => {
    const syncOnce = syncMock().mockResolvedValue({ updated: 0, skipped: 0 });
    const job = startPriceSync({
      sync: { syncOnce },
      intervalMs: 1000,
      logger: { error: jest.fn() }
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(syncOnce).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1000);
    expect(syncOnce).toHaveBeenCalledTimes(2);

    job.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(syncOnce).toHaveBeenCalledTimes(2);
  });

  it('логирует ошибку внешнего API и продолжает работу', async () => {
    const syncOnce = syncMock().mockRejectedValue(new Error('upstream down'));
    const error = jest.fn();
    const job = startPriceSync({
      sync: { syncOnce },
      intervalMs: 1000,
      logger: { error }
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[1])).toContain('upstream down');

    await jest.advanceTimersByTimeAsync(1000);
    expect(syncOnce).toHaveBeenCalledTimes(2);

    job.stop();
  });

  it('не допускает параллельных запусков', async () => {
    let finish: (() => void) | undefined;
    const syncOnce = jest.fn().mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          finish = () => resolve({ updated: 0, skipped: 0 });
        })
    );

    const job = startPriceSync({
      sync: { syncOnce },
      intervalMs: 1000,
      logger: { error: jest.fn() }
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(syncOnce).toHaveBeenCalledTimes(1);

    // Первый запуск ещё не завершён — тик по интервалу должен быть пропущен.
    await jest.advanceTimersByTimeAsync(1000);
    expect(syncOnce).toHaveBeenCalledTimes(1);

    finish?.();
    await jest.advanceTimersByTimeAsync(0);

    await jest.advanceTimersByTimeAsync(1000);
    expect(syncOnce).toHaveBeenCalledTimes(2);

    job.stop();
  });

  it('runNow() можно вызвать вручную', async () => {
    const syncOnce = syncMock().mockResolvedValue({ updated: 1, skipped: 0 });
    const job = startPriceSync({
      sync: { syncOnce },
      intervalMs: 1000,
      logger: { error: jest.fn() }
    });

    await jest.advanceTimersByTimeAsync(0);
    await job.runNow();
    expect(syncOnce).toHaveBeenCalledTimes(2);

    job.stop();
  });
});
