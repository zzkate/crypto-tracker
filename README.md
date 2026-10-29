# Crypto Price Tracker API

Backend-сервис для отслеживания криптовалют и агрегации цен из CoinMarketCap.
REST API на Express/TypeScript, хранение в SQLite (raw SQL, без ORM), фоновое
обновление цен и OpenAPI-документация.

## Возможности

- Bearer-аутентификация собственного API (`APP_API_KEY`).
- CRUD по отслеживаемым криптовалютам.
- Получение актуальных цен всех отслеживаемых монет.
- История цен по каждой монете с фильтрами по времени и лимитом.
- Фоновая синхронизация с CoinMarketCap (интервал настраивается).
- Ручной запуск синхронизации.
- Таймауты и обработка ошибок внешнего API (фоновый процесс не падает).
- Graceful shutdown по `SIGINT`/`SIGTERM`.
- Swagger UI (`/docs`) и OpenAPI 3.0 (`/openapi.json`).
- Тесты Jest + Supertest, включая фоновые задачи и ошибки внешнего API.

## Стек

- Node.js **>= 22.5** + TypeScript
- Express
- SQLite через встроенный модуль `node:sqlite` — **raw SQL, без ORM**
- axios (таймаут на запросы к CoinMarketCap)
- Jest + Supertest
- Swagger UI (`swagger-ui-express`)
- Docker / docker-compose

### Почему `node:sqlite`

Задание требует SQLite без ORM и разрешает стандартные возможности Node.js.
`node:sqlite` — встроенный модуль Node 22, поэтому не нужен сторонний драйвер
(`better-sqlite3`/`sqlite3`) и нативная сборка. Отсюда требование Node >= 22.5.

## Структура проекта

```
src/
  app.ts                  # сборка Express-приложения (без listen)
  server.ts               # точка входа, БД, фоновая джоба, graceful shutdown
  config.ts               # конфигурация из переменных окружения
  db.ts                   # открытие SQLite и схема (raw SQL)
  validation.ts           # валидация входных данных
  openapi.json            # OpenAPI 3.0 спецификация
  middleware/
    auth.ts               # Bearer auth
    error.ts              # HttpError и error middleware
  repositories/
    coins.ts              # SQL для coins
    prices.ts             # SQL для price_history
  services/
    coinmarketcap.ts      # клиент CoinMarketCap (axios, timeout)
    sync.ts               # логика синхронизации цен
  jobs/
    priceSync.ts          # фоновый запуск синхронизации
  routes/
    coins.ts, prices.ts, sync.ts
test/                     # Jest + Supertest
```

## Быстрый старт (локально)

```bash
cp .env.example .env
# отредактируйте .env: как минимум APP_API_KEY и CMC_API_KEY

npm ci
npm run build
npm start        # подхватит .env, если он есть
```

`npm start` использует `node --env-file-if-exists=.env`, поэтому работает в двух режимах:

- **локально** — все переменные берутся из `.env`;
- **CI/Docker** — `.env` может отсутствовать, переменные приходят из окружения
  (GitHub Actions: `${{ secrets.* }}`, Docker Compose: `env_file: .env` или `-e`).

Без `CMC_API_KEY` сервис тоже стартует: CRUD и чтение работают, но фоновая
синхронизация отключена, а `POST /api/sync` вернёт `502`.

Проверка:

```bash
curl http://localhost:3000/health
curl -H "Authorization: Bearer $APP_API_KEY" http://localhost:3000/api/coins
```

Документация: <http://localhost:3000/docs>, спецификация: `/openapi.json`.

## Просмотр в браузере

После `npm start`:

- Swagger UI — <http://localhost:3000/docs>
- OpenAPI — <http://localhost:3000/openapi.json>
- Health — <http://localhost:3000/health>

В Swagger UI нажмите **Authorize** и вставьте значение `APP_API_KEY` из `.env`
(без префикса `Bearer` — Swagger добавит его сам).

Если порт 3000 занят: `PORT=3001 npm start` — переменная из shell перекрывает `.env`.

## Docker

```bash
# .env используется docker compose для подстановки переменных
cp .env.example .env
# заполните APP_API_KEY/CMC_API_KEY
docker compose up --build
```

- API: <http://localhost:3000>
- Swagger UI: <http://localhost:3000/docs>
- SQLite хранится в named volume `crypto-data`, а не в репозитории.

Остановка: `docker compose down` (данные останутся в volume; `down -v` удалит их).

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `PORT` | нет | `3000` | Порт HTTP-сервера |
| `APP_API_KEY` | **да** | — | Bearer-токен для собственного API |
| `CMC_API_KEY` | нет | — | Ключ CoinMarketCap; без него синхронизация выключена |
| `CMC_BASE_URL` | нет | `https://pro-api.coinmarketcap.com` | Базовый URL CoinMarketCap |
| `CMC_TIMEOUT_MS` | нет | `5000` | Таймаут запроса к CoinMarketCap |
| `SYNC_INTERVAL_MS` | нет | `60000` | Интервал фоновой синхронизации |
| `PRICE_CURRENCY` | нет | `USD` | Единая валюта цен для всего приложения |
| `DB_PATH` | нет | `data/crypto.db` | Путь к файлу SQLite |

`CMC_API_KEY` используется только на сервере и никогда не возвращается клиенту.

## API

Все `/api/*` требуют заголовок:

```
Authorization: Bearer <APP_API_KEY>
```

| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | Проверка живости (без auth) |
| GET | `/openapi.json` | OpenAPI 3.0 спецификация |
| GET | `/docs` | Swagger UI |
| GET | `/api/coins` | Список отслеживаемых монет |
| POST | `/api/coins` | Добавить монету `{ "symbol": "BTC", "name": "Bitcoin" }` |
| GET | `/api/coins/:id` | Монета по id |
| PATCH | `/api/coins/:id` | Обновить `symbol`/`name` |
| DELETE | `/api/coins/:id` | Удалить монету и её историю |
| GET | `/api/prices/latest` | Последняя цена по каждой монете |
| GET | `/api/coins/:id/prices` | История цен (`from`, `to`, `limit`) |
| GET | `/api/coins/:id/prices/latest` | Последняя цена монеты |
| POST | `/api/sync` | Ручной запуск синхронизации |

Коды ошибок: `400` — валидация, `401` — нет/неверный токен, `404` — не найдено,
`409` — дубликат символа, `502` — ошибка CoinMarketCap.

### Примеры

```bash
BASE=http://localhost:3000
AUTH="Authorization: Bearer $APP_API_KEY"

curl -X POST "$BASE/api/coins" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"symbol":"BTC","name":"Bitcoin"}'

curl -X POST "$BASE/api/coins" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"symbol":"ETH","name":"Ethereum"}'

curl -X POST "$BASE/api/sync" -H "$AUTH"

curl "$BASE/api/prices/latest" -H "$AUTH"
curl "$BASE/api/coins/1/prices?limit=10" -H "$AUTH"
curl "$BASE/api/coins/1/prices?from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z" -H "$AUTH"
```

Пример ответа `GET /api/prices/latest`:

```json
[
  {
    "coinId": 1,
    "symbol": "BTC",
    "name": "Bitcoin",
    "price": 65000.12,
    "currency": "USD",
    "fetchedAt": "2026-10-29T10:00:00.000Z"
  }
]
```

## Модель данных

```sql
CREATE TABLE coins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_currency TEXT NOT NULL,
  last_updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coin_id INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

Время хранится в ISO 8601 (UTC). История индексируется по `(coin_id, fetched_at DESC)`.

## Синхронизация и устойчивость

- При старте (если задан `CMC_API_KEY`) синхронизация выполняется сразу и затем
  каждые `SYNC_INTERVAL_MS`.
- Одновременные запуски не пересекаются: пока предыдущий не завершился, новый тик пропускается.
- При ошибке CoinMarketCap (таймаут/5xx/невалидный ответ) ошибка логируется,
  фоновая джоба продолжает работать, данные не портятся (сначала запрос, потом запись).
- `SIGINT`/`SIGTERM`: цикл останавливается, HTTP-сервер закрывается, БД закрывается;
  через 10 секунд — принудительный выход.
- Валюта (`PRICE_CURRENCY`) едина для всего приложения и сохраняется в каждой точке истории.

## Валидация

- `symbol`: 2–10 символов `A-Z0-9`, приводится к верхнему регистру, уникален.
- `name`: 1–100 символов.
- `id`: положительное целое.
- `from`/`to`: корректные ISO-даты, `from <= to`.
- `limit`: 1–1000 (по умолчанию 100).
- Невалидный JSON в теле → `400`.

## Тесты

```bash
npm test              # 58 тестов, in-memory SQLite, без сети
npm run test:coverage # покрытие
```

Покрыто: аутентификация, CRUD (позитивные и негативные сценарии), история и
актуальные цены, ручная синхронизация, ошибки/таймауты внешнего API, фоновая
джоба (запуск по интервалу, обработка ошибок, отсутствие параллельных запусков,
остановка), OpenAPI/Swagger.

## Ручной интеграционный прогон (реальный CoinMarketCap)

В GitHub Actions: **Actions → Integration (CoinMarketCap) → Run workflow**.
Нужен секрет репозитория `CMC_API_KEY` (Settings → Secrets and variables → Actions).
Можно задать `symbols` (по умолчанию `BTC,ETH`) и `currency` (по умолчанию `USD`).

Workflow поднимает сервис, добавляет монеты, вызывает `POST /api/sync` (реальный
запрос в CoinMarketCap) и проверяет, что у каждой монеты появилась цена.

Локально:

```bash
npm run build
CMC_API_KEY=... APP_API_KEY=... bash scripts/integration-cmc.sh
```

Не запускается на push — только вручную; расходует кредиты CoinMarketCap.

## Ограничения

- Одна валюта на приложение (`PRICE_CURRENCY`, по умолчанию USD).
- CoinMarketCap имеет лимиты запросов/символов на тариф; при большом списке
  монет может потребоваться батчинг (сейчас один запрос на синхронизацию).
- SQLite выбран по условию задания; для высоких нагрузок нужна другая СУБД.
