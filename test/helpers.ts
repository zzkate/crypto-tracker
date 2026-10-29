import type { Express } from 'express';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { openDb, type Db } from '../src/db';
import type { CmcClient } from '../src/services/coinmarketcap';
import { PriceSyncService } from '../src/services/sync';

export const TEST_API_KEY = 'test-api-key';
export const AUTH = `Bearer ${TEST_API_KEY}`;

export interface TestContext {
  app: Express;
  db: Db;
  config: AppConfig;
  syncService: PriceSyncService;
  client: CmcClient;
}

export function makeContext(overrides?: {
  client?: CmcClient;
  currency?: string;
}): TestContext {
  const db = openDb(':memory:');
  const config: AppConfig = {
    port: 0,
    appApiKey: TEST_API_KEY,
    cmcApiKey: 'test-cmc-key',
    cmcBaseUrl: 'http://cmc.invalid',
    cmcTimeoutMs: 1000,
    syncIntervalMs: 1000,
    currency: overrides?.currency ?? 'USD',
    dbPath: ':memory:',
    cmcBatchSize: 100,
    cmcMaxRetries: 0,
    cmcRetryBackoffMs: 200
  };

  const client: CmcClient =
    overrides?.client ?? { async fetchPrices() { return new Map<string, number>(); } };
  const syncService = new PriceSyncService(db, client, config.currency);
  const app = createApp({ db, config, syncService });

  return { app, db, config, syncService, client };
}
