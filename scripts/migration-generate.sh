#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?Вкажіть назву міграції, наприклад: ./scripts/migration-generate.sh AddPlaceNotes}"
DB="${2:-}"
mkdir -p api/src/migrations
docker compose build api
docker compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -e MIGRATION_DB="$DB" -v "$PWD/api/src/migrations:/out" --entrypoint sh api -c 'if [ -n "$MIGRATION_DB" ]; then export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/$MIGRATION_DB"; fi; node node_modules/typeorm/cli.js migration:generate -d dist/data-source.js "/out/$0"' "$NAME"
