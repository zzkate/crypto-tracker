import type { AppConfig } from './config';
import type { Db } from './db';
import type { PriceSyncService } from './services/sync';

export interface AppContext {
  db: Db;
  config: AppConfig;
  syncService: PriceSyncService;
}
