import axios from 'axios';

export interface CmcClient {
  /** Возвращает цену в указанной валюте для каждого найденного символа. */
  fetchPrices(symbols: string[], currency: string): Promise<Map<string, number>>;
}

export interface HttpClient {
  get(url: string, config?: { params?: Record<string, string> }): Promise<{ data: unknown }>;
}

export interface CmcClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Позволяет подменить HTTP-клиент в тестах. */
  http?: HttpClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createCmcClient(options: CmcClientOptions): CmcClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error('CMC_API_KEY is required to create CoinMarketCap client');
  }

  const http: HttpClient =
    options.http ??
    (axios.create({
      baseURL: options.baseUrl ?? 'https://pro-api.coinmarketcap.com',
      timeout: options.timeoutMs ?? 5000,
      headers: {
        'X-CMC_PRO_API_KEY': apiKey,
        Accept: 'application/json'
      }
    }) as unknown as HttpClient);

  return {
    async fetchPrices(symbols: string[], currency: string): Promise<Map<string, number>> {
      const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
      if (unique.length === 0) return new Map();

      const { data } = await http.get('/v1/cryptocurrency/quotes/latest', {
        params: { symbol: unique.join(','), convert: currency }
      });

      if (!isRecord(data) || !isRecord(data.data)) {
        throw new Error('CoinMarketCap: unexpected response');
      }

      const result = new Map<string, number>();
      for (const [symbol, entry] of Object.entries(data.data)) {
        if (!isRecord(entry) || !isRecord(entry.quote)) continue;
        const quote = entry.quote[currency];
        if (!isRecord(quote)) continue;
        if (typeof quote.price === 'number' && Number.isFinite(quote.price)) {
          result.set(symbol.toUpperCase(), quote.price);
        }
      }
      return result;
    }
  };
}
