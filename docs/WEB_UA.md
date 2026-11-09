# Вебзастосунок DigiComp HUB

Фронт (React + TypeScript + Vite, PWA) лежить у `web/`. Збірку `web/dist` роздає той самий NestJS з того самого домену:
- сторінки застосунку — на будь-якій адресі (`/`, `/tasks`, `/lab/CNC-1`...);
- API — лише під `/api`;
- `/health` — у корені.

Тому cookie-вхід, CSRF і CSP працюють без CORS.

## Команди

    cd web
    npm ci
    npm run dev          # http://localhost:5173, запити /api проксуються на API :3000
    npm test             # Vitest + Testing Library
    npm run lint         # oxlint
    npm run typecheck
    npm run build        # tokens → tsc → vite build → web/dist
    npm run api:types    # типи API з ../api/openapi.json → src/api/schema.d.ts

- **API для `npm run dev`:** запустіть його локально (`cd api && npm run start:dev`) або через `docker compose`.
- **Після зміни API:**
  1. Зберіть API й оновіть схему: `cd api && npm run build && npm run openapi`.
  2. Оновіть типи у фронті: `cd web && npm run api:types`.
  3. Закомітьте обидва файли.

## Як влаштовано

- **`src/api/client.ts`:**
  - типізований клієнт (`openapi-fetch`), завжди шле `X-DC-Client: web`;
  - на 401 один раз оновлює сесію для всіх паралельних запитів;
  - якщо оновити сесію не вдалося, відкривається екран входу.
- **`src/auth/`:**
  - поточний користувач (`/api/auth/me`), вхід, другий крок 2FA (код або запасний код), вихід;
  - права в інтерфейсі беруться з `permissions`, але остаточно їх перевіряє сервер.
- **`src/errors/messages.ts`:** людський текст для кожного `errorCode`. Тест `messages.test.ts` збирає коди з бекенду й падає, якщо для якогось коду немає тексту.
- **`src/layout/`:**
  - на телефоні — нижня панель (Головна, ТЗ, «Скан QR», Лабораторія, Профіль) і меню «Ще»;
  - на комп'ютері (від 900 px) — бічне меню;
  - розділ «Керування» бачать лише модератори й адмін.
- **Стилі:**
  - CSS-модулі й CSS-змінні;
  - `src/styles/tokens.css` генерується з [`docs/design/tokens.json`](design/tokens.json) (`npm run tokens`), руками не редагується.
- **Теми:** системна, світла або темна, вибір зберігається на пристрої. Із системним «менше руху» анімації вимкнено.
- **Шрифт:** e-Ukraine (WOFF2) у `public/fonts/` разом з `LICENSE.txt` (CC BY 4.0, атрибуція — на сторінці «Про застосунок»).
- **PWA:**
  - маніфест, іконки й service worker (`vite-plugin-pwa`);
  - service worker кешує лише оболонку застосунку. Відповіді API не кешуються ніколи: вони особисті й мають бути свіжими.

## Вхід через cookie

- **`POST /api/auth/login` із заголовком `X-DC-Client: web`:**
  - ставить два HttpOnly-cookie: `dc_at` на 1 годину і `dc_rt` на 30 днів (шлях `/api/auth`);
  - тіло відповіді містить лише `user`: токени ніколи не потрапляють у JavaScript;
  - якщо в людини увімкнена 2FA, відповідь — `{ twoFactorRequired, challengeToken }`, а cookie ставить `POST /api/auth/2fa/verify`.
- **`/api/auth/refresh` і `/api/auth/logout`** беруть refresh-токен із cookie.
- **Звичайні API-клієнти** (curl, скрипти) працюють як раніше: токени в тілі відповіді й заголовок `Authorization: Bearer`.

## Захист від підробки запитів (CSRF)

- Cookie мають `SameSite=Strict`.
- Усі запити, що змінюють дані за cookie-входу, мусять нести заголовок `X-DC-Client: web`. Заголовок `Origin`, якщо він є, має збігатися з адресою сервера (`Host` або `X-Forwarded-Host`). Інакше 403 із кодом `CSRF`.
- Запити з `Authorization: Bearer` і без cookie ця перевірка не зачіпає.

## Заголовки безпеки й кешування

- **CSP на кожній відповіді, сторінки застосунку теж:**
  - заборонені вбудовані скрипти й стилі та зовнішні ресурси, все вантажиться з власного домену;
  - збірка Vite не містить вбудованих скриптів, тому CSP послаблювати не потрібно.
- **Інші заголовки:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` (камеру дозволено лише власному сайту, для сканування QR).
- **Кешування:**

  | Що | `Cache-Control` |
  | --- | --- |
  | API | `no-store` |
  | `index.html`, service worker, маніфест | `no-cache` (оновлення приходять одразу) |
  | файли з хешем у `/assets/` | кешуються назавжди |
  | шрифти й іконки | тиждень |

- **Код:** `api/src/common/web.ts` і `api/src/web/serve-web.ts`, підключення в `api/src/setup-app.ts`.

## Змінні в `.env`

    COOKIE_SECURE=true
    PUBLIC_ORIGIN=https://digicomp.tailfbb38b.ts.net

- `COOKIE_SECURE=true` додає прапорець Secure до cookie. Потрібно, коли сайт відкривають через https; локально — `false`.
- `PUBLIC_ORIGIN` — адреса, яка потрапляє в QR-коди. Фронт отримує її з `GET /api/app-config`.
- `WEB_DIST` — тека зібраного фронту. У Docker це `/app/web`, локально за замовчуванням `../web/dist`. Якщо збірки немає, API працює сам, без сторінок.

## Збірка образу

`api/Dockerfile` збирає фронт і API в один образ, контекст збірки — корінь репо (`docker-compose.yml`). Тож `docker compose up -d --build` оновлює все разом.

## Відомі питання

`npm audit` повідомляє про вразливість середнього рівня в `deepmerge`/`glob` через `workbox-build`. Цей пакет працює лише під час збірки й генерує service worker, у браузер він не потрапляє. Оновимо, щойно `vite-plugin-pwa` вийде з виправленням.
