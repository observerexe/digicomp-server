# Вебклієнт: вхід через cookie і захист

Старий вебінтерфейс (`api/web`) видалено на етапі 0. Новий фронт (React + Vite, PWA) з'явиться на етапі 7,
його роздаватиме той самий NestJS з того самого домену. Механізми безпеки нижче вже працюють у бекенді.

## Вхід через cookie

- `POST /auth/login` із заголовком `X-DC-Client: web` ставить два HttpOnly-cookie: `dc_at` на 1 годину і `dc_rt`
  на 30 днів (шлях `/auth`). Тіло відповіді містить лише `user`, токени ніколи не потрапляють у JavaScript.
- `/auth/refresh` і `/auth/logout` беруть refresh-токен із cookie.
- Звичайні API-клієнти (curl, скрипти) працюють як раніше: токени в тілі відповіді й заголовок `Authorization: Bearer`.

## Захист від підробки запитів (CSRF)

- Cookie мають `SameSite=Strict`.
- Усі запити, що змінюють дані за cookie-входу, мусять нести заголовок `X-DC-Client: web`, а заголовок `Origin`
  (якщо є) має збігатися з адресою сервера (`Host` або `X-Forwarded-Host`). Інакше 403 із кодом `CSRF`.
- Запити з `Authorization: Bearer` і без cookie ця перевірка не зачіпає.

## Заголовки безпеки

Кожна відповідь має політику безпеки вмісту (CSP): заборонені вбудовані скрипти й стилі і зовнішні ресурси,
усе завантажується з власного домену. Також `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy` (камера дозволена лише власному сайту, для сканування QR).
Відповіді API не кешуються (`Cache-Control: no-store`).

Код: `api/src/common/web.ts`, підключення в `api/src/setup-app.ts`.

## Змінні в `.env`

    COOKIE_SECURE=true
    PUBLIC_ORIGIN=https://digicomp.tailfbb38b.ts.net

`COOKIE_SECURE=true` додає прапорець Secure до cookie (потрібно, коли сайт відкривають через https; локально `false`).
`PUBLIC_ORIGIN` це адреса, яка потрапляє в QR-коди місць; фронт отримує її з `GET /app-config`.

## Перехід зі старого шлюзу

Старий фронт (служба `digicomp-hub`, порт 8765) працює на сервері до запуску нового. Порядок перемикання
описано в етапі 9 у [PLAN.md](PLAN.md).
