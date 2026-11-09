# DigiComp HUB

Вебзастосунок творчої групи DigiComp: команда, обладнання з QR і журналом роботи, архів документів,
розумна лабораторія (Home Assistant), склад, проєкти, ТЗ, бали, дисципліна, панелі керування.

Вимоги, ролі й план робіт: [docs/PLAN.md](docs/PLAN.md). Правила для Claude Code: [CLAUDE.md](CLAUDE.md).

## Склад репозиторію

| Шлях | Що там |
| --- | --- |
| `api/` | Бекенд: NestJS + TypeORM, PostgreSQL 17 |
| `api/src/<модуль>/` | controller, service, entity, dto кожного модуля |
| `api/src/migrations/` | Міграції бази (схема змінюється лише ними) |
| `docs/` | Довідники українською (див. нижче) |
| `scripts/` | Бекап, перевірка відновлення, генерація міграцій, systemd-таймер |
| `docker-compose.yml` | База + API, так само на сервері |
| `docker-compose.dev.yml` | Лише локально: відкриває базу на порту 5433 і створює тестову базу |

Новий фронт (React + TypeScript + Vite, PWA) з'явиться в `web/` на етапі 7.

## Локальний запуск

Потрібні Docker з Compose і Node.js 22+.

1. Створіть `.env` з прикладу і заповніть секрети:

       cp .env.example .env
       # POSTGRES_PASSWORD: openssl rand -hex 24
       # JWT_SECRET:        openssl rand -base64 48
       # Локально також: COMPOSE_PROJECT_NAME=digicomp-local

2. Запустіть базу й API:

       docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

3. Перевірте: `curl http://127.0.0.1:3000/health` має повернути `{"status":"ok","db":"up",...}`.
   Міграції застосовуються автоматично під час старту API.

4. Першого адміністратора створює `POST /auth/setup` (працює лише, поки в базі немає користувачів).
   Див. [docs/API_UA.md](docs/API_UA.md).

Home Assistant для локальної роботи не обов'язковий: без `HA_TOKEN` не працює лише розділ `/smart`.

## Тести й лінтер

    cd api
    npm ci
    npm test            # unit-тести
    npm run test:e2e    # e2e, потрібна запущена база з docker-compose.dev.yml
    npm run lint

E2e-тести працюють з окремою базою `digicomp_test` на `127.0.0.1:5433` (пароль беруть з кореневого `.env`).
Іншу базу можна задати змінною `TEST_DATABASE_URL`.

## Документація

- [docs/API_UA.md](docs/API_UA.md): ендпоінти, права, коди помилок
- [docs/WEB_UA.md](docs/WEB_UA.md): cookie-вхід, CSRF, політика безпеки вмісту
- [docs/MIGRATIONS_UA.md](docs/MIGRATIONS_UA.md): як змінювати схему бази
- [docs/BACKUP_UA.md](docs/BACKUP_UA.md): бекапи і відновлення
- [docs/SMART_UA.md](docs/SMART_UA.md): інтеграція з Home Assistant

## Розгортання

Сервер: Ubuntu Server, Docker Compose, доступ ззовні через Tailscale Funnel. Порядок:
бекап → `git pull` → `docker compose up -d --build` → перевірка `/health`.

## Ліцензія

GNU AGPL v3, див. [LICENSE](LICENSE).
