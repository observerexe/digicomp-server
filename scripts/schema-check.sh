#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose build api
if docker compose run --rm --no-deps -T --user "$(id -u):$(id -g)" --entrypoint node api node_modules/typeorm/cli.js migration:generate -d dist/data-source.js --check /tmp/check; then
  echo "Схема бази збігається з кодом."
else
  echo "Схема бази НЕ збігається з кодом: потрібна нова міграція." >&2
  exit 1
fi
