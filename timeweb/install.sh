#!/bin/sh
set -eu

APP_DIR=/opt/apps/owntravel
PUBLIC_IP=45.139.77.232
SOURCE_BASE=https://raw.githubusercontent.com/rvkrin2-collab/travel-journal/main/timeweb
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR=$APP_DIR/backups/$STAMP
TEMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

if getent ahostsv4 owntravel.ru 2>/dev/null | awk '{print $1}' | grep -qx "$PUBLIC_IP"; then
  echo "Остановка: owntravel.ru всё ещё указывает на Timeweb. Сначала верните основной домен на GitHub Pages."
  exit 1
fi

if ! getent ahostsv4 api.owntravel.ru 2>/dev/null | awk '{print $1}' | grep -qx "$PUBLIC_IP"; then
  echo "Остановка: api.owntravel.ru ещё не указывает на $PUBLIC_IP."
  exit 1
fi

for file in Caddyfile compose.yaml media-cache/Dockerfile media-cache/server.mjs; do
  mkdir -p "$TEMP_DIR/$(dirname "$file")"
  curl --fail --silent --show-error --location "$SOURCE_BASE/$file" --output "$TEMP_DIR/$file"
done

mkdir -p "$APP_DIR/media-cache" "$BACKUP_DIR"
for file in Caddyfile compose.yaml; do
  if [ -f "$APP_DIR/$file" ]; then
    cp -a "$APP_DIR/$file" "$BACKUP_DIR/$file"
  fi
done

install -m 644 "$TEMP_DIR/Caddyfile" "$APP_DIR/Caddyfile"
install -m 644 "$TEMP_DIR/compose.yaml" "$APP_DIR/compose.yaml"
install -m 644 "$TEMP_DIR/media-cache/Dockerfile" "$APP_DIR/media-cache/Dockerfile"
install -m 644 "$TEMP_DIR/media-cache/server.mjs" "$APP_DIR/media-cache/server.mjs"

cd "$APP_DIR"
docker compose -p owntravel config --quiet
docker compose -p owntravel build media

if ! docker compose -p owntravel up -d; then
  echo "Запуск не удался; возвращаю прежнюю конфигурацию."
  [ -f "$BACKUP_DIR/Caddyfile" ] && cp -a "$BACKUP_DIR/Caddyfile" "$APP_DIR/Caddyfile"
  [ -f "$BACKUP_DIR/compose.yaml" ] && cp -a "$BACKUP_DIR/compose.yaml" "$APP_DIR/compose.yaml"
  docker compose -p owntravel up -d
  exit 1
fi

attempt=0
until curl --fail --silent --show-error --max-time 15 https://api.owntravel.ru/health >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 12 ]; then
    echo "API не прошёл проверку; возвращаю прежнюю конфигурацию."
    [ -f "$BACKUP_DIR/Caddyfile" ] && cp -a "$BACKUP_DIR/Caddyfile" "$APP_DIR/Caddyfile"
    [ -f "$BACKUP_DIR/compose.yaml" ] && cp -a "$BACKUP_DIR/compose.yaml" "$APP_DIR/compose.yaml"
    docker compose -p owntravel up -d
    exit 1
  fi
  sleep 5
done

PHOTO_PATH=/thumbnail/kolskiy-u-vody-i-pod-vodoy/pod-vodoy-barentseva-morya/e2f14c91-cfc4-4b33-9a4b-ebdf0fe2767a.jpg?w=720
curl --fail --silent --show-error --max-time 45 "https://api.owntravel.ru$PHOTO_PATH" --output /dev/null
CACHE_HEADER=$(curl --fail --silent --show-error --head --max-time 20 "https://api.owntravel.ru$PHOTO_PATH" | tr -d '\r' | awk -F ': ' 'tolower($1)=="x-owntravel-cache" {print $2}')
if [ "$CACHE_HEADER" != "HIT" ]; then
  echo "Фотография загрузилась, но локальный кеш не подтвердился. Конфигурация оставлена для диагностики."
  exit 1
fi

docker compose -p owntravel ps
echo "Готово: API отвечает, фотография сохранена и повторно отдана из Timeweb-кеша. Резервная копия: $BACKUP_DIR"
