#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-$HOME/backups/digicomp}"
LATEST="$(ls -1t "$DEST"/db-*.dump 2>/dev/null | head -n1 || true)"
[ -n "$LATEST" ] || { echo "Немає жодного дампу в $DEST" >&2; exit 1; }
echo "Перевіряю: $LATEST"

docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists restore_check && createdb -U "$POSTGRES_USER" restore_check'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner' < "$LATEST"
USERS="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -tAc "SELECT count(*) FROM users"' | tr -d '[:space:]')"
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_check'

echo "Відновлення працює: у копії користувачів — $USERS"
