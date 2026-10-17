#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ls api/src/migrations/*-Baseline.ts >/dev/null 2>&1; then
  echo "Базова міграція вже існує: $(ls api/src/migrations/*-Baseline.ts)" >&2
  exit 1
fi

docker compose up -d db
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists baseline_tmp && createdb -U "$POSTGRES_USER" baseline_tmp'
./scripts/migration-generate.sh Baseline baseline_tmp
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" baseline_tmp'

FILE="$(ls -1t api/src/migrations/*-Baseline.ts | head -n1)"
sed -i "0,/public async up(queryRunner: QueryRunner): Promise<void> {/s//&\n        if (await queryRunner.hasTable('users')) return;/" "$FILE"
grep -q "hasTable('users')" "$FILE" || { echo "Не вдалося додати захист у $FILE" >&2; exit 1; }

echo "Готово: $FILE"
