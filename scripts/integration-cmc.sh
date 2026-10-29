#!/usr/bin/env bash
#
# Ручной интеграционный прогон с реальным CoinMarketCap.
# Требует CMC_API_KEY в окружении. Значение ключа не печатается.
#
# Переменные:
#   CMC_API_KEY      — обязательно
#   APP_API_KEY      — токен собственного API (по умолчанию integration-test-key)
#   SYMBOLS          — список символов через запятую (по умолчанию BTC,ETH)
#   PRICE_CURRENCY   — валюта (по умолчанию USD)
#   PORT             — порт (по умолчанию 3010)
#   DB_PATH          — путь к SQLite (по умолчанию временный файл)

set -euo pipefail

: "${CMC_API_KEY:?CMC_API_KEY is required}"

APP_API_KEY="${APP_API_KEY:-integration-test-key}"
SYMBOLS="${SYMBOLS:-BTC,ETH}"
PRICE_CURRENCY="${PRICE_CURRENCY:-USD}"
PORT="${PORT:-3010}"
BASE="http://127.0.0.1:${PORT}"
DB_PATH="${DB_PATH:-/tmp/crypto-integration-$$.db}"
SERVER_LOG="${SERVER_LOG:-/tmp/crypto-integration-server.log}"
BODY=/tmp/crypto-integration-body

cd "$(dirname "$0")/.."

if [ ! -f dist/server.js ]; then
  echo "Сначала соберите проект: npm run build"
  exit 1
fi

rm -f "$DB_PATH"
PORT="$PORT" \
APP_API_KEY="$APP_API_KEY" \
CMC_API_KEY="$CMC_API_KEY" \
CMC_TIMEOUT_MS="${CMC_TIMEOUT_MS:-15000}" \
PRICE_CURRENCY="$PRICE_CURRENCY" \
DB_PATH="$DB_PATH" \
  node --disable-warning=ExperimentalWarning dist/server.js >"$SERVER_LOG" 2>&1 &
SRV=$!

cleanup() {
  kill "$SRV" 2>/dev/null || true
  wait "$SRV" 2>/dev/null || true
  rm -f "$DB_PATH"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "$BASE/health"; then ready=1; break; fi
  sleep 0.2
done
if [ "$ready" != "1" ]; then
  echo "Сервис не запустился"
  cat "$SERVER_LOG"
  exit 1
fi

AUTH="Authorization: Bearer $APP_API_KEY"

IFS=',' read -ra COINS <<< "$SYMBOLS"
if [ "${#COINS[@]}" -eq 0 ]; then
  echo "Пустой список SYMBOLS"
  exit 1
fi

for raw in "${COINS[@]}"; do
  symbol="$(printf '%s' "$raw" | tr '[:lower:]' '[:upper:]' | xargs)"
  [ -z "$symbol" ] && continue

  code=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/coins" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"symbol\":\"$symbol\",\"name\":\"$symbol\"}")
  if [ "$code" != "201" ]; then
    echo "Не удалось добавить $symbol: HTTP $code $(cat "$BODY")"
    exit 1
  fi
  echo "Добавлена монета: $symbol"
done

echo "Вызываю реальный CoinMarketCap через POST /api/sync..."
sync_code=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$BASE/api/sync" -H "$AUTH")
echo "POST /api/sync -> HTTP $sync_code: $(cat "$BODY")"
if [ "$sync_code" != "200" ]; then
  echo "Синхронизация не удалась"
  exit 1
fi

curl -s "$BASE/api/prices/latest" -H "$AUTH" > /tmp/crypto-integration-prices.json

node - <<'NODE'
const fs = require('node:fs');
const prices = JSON.parse(fs.readFileSync('/tmp/crypto-integration-prices.json', 'utf8'));
if (!Array.isArray(prices) || prices.length === 0) {
  console.error('Пустой ответ /api/prices/latest');
  process.exit(1);
}
let ok = true;
for (const p of prices) {
  const valid =
    typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0 &&
    typeof p.fetchedAt === 'string' && p.fetchedAt.length > 0;
  console.log(`${p.symbol}: price=${p.price} ${p.currency} fetchedAt=${p.fetchedAt} -> ${valid ? 'OK' : 'FAIL'}`);
  if (!valid) ok = false;
}
process.exit(ok ? 0 : 1);
NODE

echo "Интеграционный прогон успешен."
