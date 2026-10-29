import { createCmcClient } from '../src/services/coinmarketcap';

describe('CoinMarketCap client', () => {
  it('парсит ответ и передаёт параметры запроса', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        data: {
          BTC: { quote: { USD: { price: 65000.5 } } },
          ETH: { quote: { USD: { price: 3200 } } }
        }
      }
    });

    const client = createCmcClient({ apiKey: 'key', http: { get } });
    const prices = await client.fetchPrices(['btc', 'ETH', 'BTC'], 'USD');

    expect(get).toHaveBeenCalledWith('/v1/cryptocurrency/quotes/latest', {
      params: { symbol: 'BTC,ETH', convert: 'USD' }
    });
    expect(prices.get('BTC')).toBe(65000.5);
    expect(prices.get('ETH')).toBe(3200);
    expect(prices.size).toBe(2);
  });

  it('пропускает монеты без корректной цены', async () => {
    const get = jest.fn().mockResolvedValue({
      data: {
        data: {
          BTC: { quote: { USD: { price: 'not-a-number' } } },
          ETH: { quote: {} },
          SOL: { quote: { USD: { price: 100 } } }
        }
      }
    });

    const client = createCmcClient({ apiKey: 'key', http: { get } });
    const prices = await client.fetchPrices(['BTC', 'ETH', 'SOL'], 'USD');

    expect([...prices.keys()]).toEqual(['SOL']);
  });

  it('не делает запрос для пустого списка символов', async () => {
    const get = jest.fn();
    const client = createCmcClient({ apiKey: 'key', http: { get } });
    const prices = await client.fetchPrices([], 'USD');

    expect(prices.size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });

  it('бросает ошибку при неожиданном ответе API', async () => {
    const get = jest.fn().mockResolvedValue({ data: { status: 'error' } });
    const client = createCmcClient({ apiKey: 'key', http: { get } });

    await expect(client.fetchPrices(['BTC'], 'USD')).rejects.toThrow(
      'CoinMarketCap: unexpected response'
    );
  });

  it('пробрасывает ошибку HTTP-клиента (таймаут/сеть)', async () => {
    const get = jest.fn().mockRejectedValue(new Error('timeout of 5000ms exceeded'));
    const client = createCmcClient({ apiKey: 'key', http: { get } });

    await expect(client.fetchPrices(['BTC'], 'USD')).rejects.toThrow('timeout');
  });

  it('требует непустой API key', () => {
    expect(() => createCmcClient({ apiKey: '   ' })).toThrow('CMC_API_KEY is required');
  });
});
