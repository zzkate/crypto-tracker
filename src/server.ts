import { createApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';
import { startPriceSync } from './jobs/priceSync';
import { createCmcClient, type CmcClient } from './services/coinmarketcap';
import { PriceSyncService } from './services/sync';

function main(): void {
  const config = loadConfig();
  const db = openDb(config.dbPath);

  let stopJob: (() => void) | undefined;

  const client: CmcClient = config.cmcApiKey
    ? createCmcClient({
        apiKey: config.cmcApiKey,
        baseUrl: config.cmcBaseUrl,
        timeoutMs: config.cmcTimeoutMs
      })
    : {
        async fetchPrices(): Promise<Map<string, number>> {
          throw new Error('CMC_API_KEY is not configured');
        }
      };

  const syncService = new PriceSyncService(db, client, config.currency);

  if (config.cmcApiKey) {
    const job = startPriceSync({ sync: syncService, intervalMs: config.syncIntervalMs });
    stopJob = () => job.stop();
    console.log(`[server] background sync every ${config.syncIntervalMs} ms`);
  } else {
    console.warn('[server] CMC_API_KEY is not set: background sync disabled');
  }

  const app = createApp({ db, config, syncService });
  const server = app.listen(config.port, () => {
    console.log(`[server] listening on :${config.port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);

    stopJob?.();
    server.close(() => {
      db.close();
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[server] forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
