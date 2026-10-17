#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-$HOME/backups/digicomp}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$DEST/db-$STAMP.dump"
[ -s "$DEST/db-$STAMP.dump" ] || { echo "Порожній дамп бази" >&2; rm -f "$DEST/db-$STAMP.dump"; exit 1; }

docker compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -v "$DEST":/backup --entrypoint tar api czf "/backup/files-$STAMP.tgz" -C /data/files .
[ -s "$DEST/files-$STAMP.tgz" ] || { echo "Порожній архів файлів" >&2; exit 1; }

ls -1t "$DEST"/db-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
ls -1t "$DEST"/files-*.tgz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --

echo "Готово: $DEST/db-$STAMP.dump і $DEST/files-$STAMP.tgz"
