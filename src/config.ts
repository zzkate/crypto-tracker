export interface AppConfig {
  port: number;
  appApiKey: string;
  cmcApiKey: string;
  cmcBaseUrl: string;
  cmcTimeoutMs: number;
  syncIntervalMs: number;
  currency: string;
  dbPath: string;
  cmcBatchSize: number;
  cmcMaxRetries: number;
  cmcRetryBackoffMs: number;
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appApiKey = env.APP_API_KEY?.trim();
  if (!appApiKey) {
    throw new Error('APP_API_KEY is required');
  }

  const currency = (env.PRICE_CURRENCY ?? 'USD').trim().toUpperCase();
  if (!/^[A-Z]{2,10}$/.test(currency)) {
    throw new Error('PRICE_CURRENCY must be a currency code, e.g. USD');
  }

  return {
    port: positiveInt(env.PORT, 3000, 'PORT'),
    appApiKey,
    cmcApiKey: env.CMC_API_KEY?.trim() ?? '',
    cmcBaseUrl: (env.CMC_BASE_URL ?? 'https://pro-api.coinmarketcap.com').replace(/\/+$/, ''),
    cmcTimeoutMs: positiveInt(env.CMC_TIMEOUT_MS, 5000, 'CMC_TIMEOUT_MS'),
    syncIntervalMs: positiveInt(env.SYNC_INTERVAL_MS, 60_000, 'SYNC_INTERVAL_MS'),
    currency,
    dbPath: env.DB_PATH?.trim() || 'data/crypto.db',
    cmcBatchSize: positiveInt(env.CMC_BATCH_SIZE, 100, 'CMC_BATCH_SIZE'),
    cmcMaxRetries: nonNegativeInt(env.CMC_MAX_RETRIES, 2, 'CMC_MAX_RETRIES'),
    cmcRetryBackoffMs: positiveInt(env.CMC_RETRY_BACKOFF_MS, 200, 'CMC_RETRY_BACKOFF_MS')
  };
}
