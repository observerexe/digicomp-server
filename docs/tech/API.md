# API DigiComp HUB

Загальні правила, вхід, помилки й поведінка, яку не видно зі схеми. Окремі ендпоінти з полями описує Swagger:
`/api/docs` (увійдіть адміном) або файл `api/openapi.json`. Права за ролями — [ARCHITECTURE.md](ARCHITECTURE.md#ролі-та-права).

## Загальні правила

- **Адреси.** Усе API — під `/api` (`/api/tasks`, `/api/auth/login`). У корені лише `/health`; решту адрес займають сторінки застосунку.
- **Дати** — ISO 8601 в UTC. Дні, місяці й дедлайни сервер рахує за київським часом.
- **Статуси успіху.** `POST`, що створює об'єкт, — 201; дії й решта запитів — 200; дії розширеної панелі — 202.
- **Списки** — `{ items, total, page, limit }` з `page` і `limit` у query. Масивом відповідають `/places`, `/tasks`, `/discipline/me`, `/audit`, `/bookings/me`, рейтинг.
- **`:id` або код.** Для обладнання й позицій складу в шляху можна передати uuid або код з QR-наліпки (без різниці в регістрі).
- **Файли** — `multipart/form-data`, поле `file`. Документи й матеріали до 20 МБ, фото несправності до 5 МБ, аватар до 2 МБ (png, jpg, webp).
  Тип перевіряється за вмістом. Файли віддаються лише авторизованим.
- **Ідемпотентність.** Старт сеансу і рух на складі приймають `idempotencyKey` (8–64 символи): повтор з тим самим ключем повертає
  той самий результат без дубля. Новий ключ — на кожну дію людини.
- **Права в інтерфейсі** — список `permissions` у `GET /api/auth/me`. Правила, що залежать від цілі (над ким, чий запис), перевіряє лише сервер.

## Вхід

**Два режими.**

- **Застосунок (cookie).** З заголовком `X-DC-Client: web` вхід і `refresh` ставлять HttpOnly-cookie, тіло містить лише `user`.
  Кожен запит, що змінює дані, мусить нести `X-DC-Client: web`, інакше 403 `CSRF`.
- **Скрипти й інструменти (Bearer).** Без цього заголовка вхід повертає `accessToken` і `refreshToken`; далі `Authorization: Bearer <accessToken>`.

**Потік.**

- `POST /api/auth/login { email, password }`. Якщо в людини увімкнена 2FA — відповідь `{ twoFactorRequired: true, challengeToken }`,
  далі `POST /api/auth/2fa/verify { challengeToken, code }` або `{ challengeToken, recoveryCode }`. `challengeToken` діє 5 хвилин.
- `POST /api/auth/refresh` — новий токен доступу (1 год) і новий refresh (30 днів); старий refresh більше не діє.
- `POST /api/auth/logout` — цей пристрій; `POST /api/auth/logout-all` — усі.
- `POST /api/auth/setup` — створює першого адміна, лише поки в базі немає користувачів.

**2FA (свій акаунт).** `POST /api/auth/2fa/setup` → `{ secret, otpauthUri }`; `POST /api/auth/2fa/enable { code }` → 8 запасних кодів
(показуються раз) і закриття всіх сесій; `disable` і `recovery-codes` — з кодом. Адмін скидає 2FA іншому: `POST /api/users/:id/2fa/reset`.

## Помилки

Формат: `{ "statusCode": 409, "errorCode": "INSUFFICIENT_STOCK", "message": "Insufficient stock" }`.
Орієнтуйтеся лише на `errorCode`: `message` може змінитися, у помилках валідації це масив.

**Загальні:** `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `CSRF` (403), `NOT_FOUND` (404), `CONFLICT` (409),
`CONSTRAINT_VIOLATION` (409), `FILE_TOO_LARGE` (413), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503).
«Не знайдено» для конкретних об'єктів: `USER_NOT_FOUND`, `TASK_NOT_FOUND`, `PLACE_NOT_FOUND`, `SESSION_NOT_FOUND`, `BOOKING_NOT_FOUND`,
`FAULT_REPORT_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `VERSION_NOT_FOUND`, `FILE_NOT_FOUND`, `ITEM_NOT_FOUND`, `PROJECT_NOT_FOUND`,
`AUTHORIZATION_NOT_FOUND`, `POINTS_ENTRY_NOT_FOUND`, `DISCIPLINE_RECORD_NOT_FOUND`, `SMART_DEVICE_NOT_FOUND`, `AUDIT_CURSOR_NOT_FOUND`.

| Код | Статус | Коли |
|---|---|---|
| **Вхід і акаунт** | | |
| `INVALID_CREDENTIALS` | 401 | Невірні пошта чи пароль, або людину заблоковано |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh-токен недійсний, прострочений або вже використаний |
| `INVALID_CURRENT_PASSWORD` | 400 | Неправильний поточний пароль при зміні |
| `SETUP_ALREADY_COMPLETED` | 409 | Перший адмін уже є |
| `TWO_FACTOR_INVALID_CODE` | 403 | Неправильний або вже використаний код чи запасний код |
| `TWO_FACTOR_LOCKED` | 403 | 10 помилок поспіль: перевірка заблокована на 15 хвилин |
| `TWO_FACTOR_CHALLENGE_INVALID` | 401 | `challengeToken` невалідний або минуло 5 хвилин |
| `TWO_FACTOR_CODE_REQUIRED` | 400 | Не передано ні `code`, ні `recoveryCode` |
| `TWO_FACTOR_ALREADY_ENABLED`, `TWO_FACTOR_NOT_ENABLED`, `TWO_FACTOR_NO_SETUP` | 409 | 2FA вже увімкнена, ще не увімкнена або не було кроку `setup` |
| `TWO_FACTOR_NOT_CONFIGURED` | 503 | На сервері немає `TOTP_KEY` |
| `TWO_FACTOR_REQUIRED` | 403 | Розширена панель — лише після входу з кодом 2FA |
| **Права** | | |
| `TARGET_ROLE_FORBIDDEN` | 403 | Модератор діє над модератором чи адміном |
| `SELF_ACTION_FORBIDDEN` | 403 | Дія над собою: модератор через `/users/:id`, бали собі, прийняття власного ТЗ |
| `NOT_OWNER` | 403 | Чужий запис: модератор знімає лише видане собою, учасник — лише своє |
| `NOT_PARTICIPANT` | 403 | Дію з ТЗ чи проєктом може виконати лише його учасник |
| `FIELD_NOT_ALLOWED` | 403 | У `PATCH /users/me` змінено поле, яке роль собі не змінює (`field` у тілі) |
| `NOT_ALLOWED` | 403 | Аватар — лише собі; чужий видаляє лише admin |
| **Учасники** | | |
| `EMAIL_TAKEN` | 409 | Пошта вже зайнята |
| `LAST_ADMIN` | 409 | Спроба понизити чи заблокувати останнього адміна |
| `UNKNOWN_MEMBER` | 400/404 | Людини немає або вона заблокована (для балів і дисципліни — 404) |
| **ТЗ** | | |
| `TASK_FULL` | 409 | Досягнуто ліміту виконавців |
| `TASK_ALREADY_TAKEN` | 409 | Ви вже серед виконавців |
| `TASK_ALREADY_STARTED` | 409 | Роботу почато, приєднатися не можна |
| `TASK_INVALID_TRANSITION` | 409 | Дія не підходить до поточного статусу |
| `TASK_ALREADY_COMPLETED` | 409 | ТЗ виконано: змін і переходів більше немає |
| `TASK_HAS_ASSIGNEES` | 409 | Видалити можна лише вільне ТЗ без виконавців |
| `MAX_ASSIGNEES_TOO_LOW` | 409 | Ліміт менший за кількість тих, хто вже взяв ТЗ |
| **Бали й дисципліна** | | |
| `ALREADY_REVOKED` | 409 | Запис уже знято |
| `ENTRY_NOT_REVOCABLE` | 409 | Знімається лише ручне нарахування; бали за ТЗ остаточні, штраф знімається через дисципліну |
| `FINE_AMOUNT_REQUIRED`, `AMOUNT_ONLY_FOR_FINE` | 400 | `amount` обов'язковий для штрафу і заборонений для попередження чи догани |
| **Обладнання, сеанси, бронювання, несправності** | | |
| `PLACE_CODE_TAKEN` | 409 | Код обладнання вже є |
| `PLACE_IN_USE` | 409 | Обладнання зайняте (лише один користувач) |
| `PLACE_UNAVAILABLE` | 409 | Обладнання на обслуговуванні чи в архіві |
| `NOT_AUTHORIZED_FOR_PLACE` | 403 | Немає чинного допуску |
| `ACTIVE_SESSION_EXISTS` | 409 | У людини вже є активний сеанс |
| `SAFETY_CONFIRMATION_REQUIRED` | 400 | Не підтверджено техніку безпеки |
| `SESSION_ALREADY_ENDED` | 409 | Сеанс уже завершено |
| `NOT_YOUR_SESSION` | 403 | Чужий сеанс завершують лише admin і moderator |
| `REASON_REQUIRED` | 400 | Завершення чужого сеансу чи скасування чужого бронювання — лише з причиною |
| `PLACE_BOOKED` | 409 | Зараз чуже бронювання; почати може власник слоту або admin |
| `BOOKING_OVERLAP` | 409 | Час перетинається з іншим бронюванням |
| `BOOKING_IN_PAST`, `BOOKING_TOO_LONG`, `BOOKING_TOO_FAR` | 400 | У минулому, довше 12 годин або далі ніж на 60 днів |
| `BOOKING_CANCELLED`, `BOOKING_ENDED` | 409 | Бронювання вже скасоване або минуло |
| `INVALID_PERIOD` | 400 | Кінець раніше початку, або календар довший за 62 дні |
| `EXPORT_TOO_LARGE` | 400 | Понад 5000 сеансів у вивантаженні: звузьте період |
| `FAULT_CLOSED` | 409 | Звіт уже закрито |
| `FAULT_PHOTO_LIMIT` | 409 | Уже 3 фото |
| `UNKNOWN_PLACE` | 400/404 | Обладнання немає або воно недоступне |
| **Склад, документи, проєкти, файли** | | |
| `ITEM_CODE_TAKEN` | 409 | Код позиції вже є |
| `INSUFFICIENT_STOCK` | 409 | Недостатньо залишку |
| `INTEGER_REQUIRED` | 400/409 | Для цієї одиниці (шт, уп, pcs) кількість ціла |
| `DELTA_ZERO`, `NOTE_REQUIRED` | 400 | Нульовий рух або порожній коментар |
| `STOCK_RECEIVE_FORBIDDEN` | 403 | Поповнення заборонене для ролі (зараз поповнювати можуть усі) |
| `PROJECT_EDIT_FORBIDDEN`, `PROJECT_MEMBERS_FORBIDDEN` | 403 | Немає права редагувати проєкт чи склад учасників |
| `PROJECT_DATES_INVALID` | 400 | Дедлайн раніше дати початку |
| `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_CONTENT_MISMATCH` | 400 | Немає файлу, тип не дозволений або вміст не відповідає типу |
| **Розумна лабораторія** | | |
| `SMART_NOT_CONFIGURED`, `SMART_UNAVAILABLE`, `SMART_AUTH_FAILED` | 503 | Немає `HA_TOKEN`, HA не відповідає за 5 с або відхилив токен |
| `UNKNOWN_HA_ENTITY`, `ENTITY_KIND_MISMATCH`, `SMART_ENTITY_EXISTS` | 400/409 | Такого пристрою в HA немає, тип не збігається, або вже доданий |
| `DEVICE_UNAVAILABLE` | 409 | Пристрій у HA вимкнений чи без зв'язку |
| `BRIGHTNESS_REQUIRES_ON` | 400 | Яскравість — лише разом з `on: true` |
| **Розширена панель** | | |
| `AGENT_UNAVAILABLE` | 503 | Агент на сервері не відповідає |
| `AGENT_BUSY` | 409 | Уже виконується інша дія |

Новий код додається у трьох місцях: `api/src/common/http-exception.filter.ts`, `web/src/errors/messages.ts` і ця таблиця.

## Поведінка, яку не видно зі схеми

### Учасники

- `PATCH /api/users/me`: `bio` — усі; `position`, `specialty` — admin і moderator; `name` — лише admin. Надіслане без змін поле помилки не дає.
- `PATCH /api/users/:id`: ім'я, email, біо — admin; посада, спеціальність, `active` — admin і moderator (moderator лише для `member`);
  `member → moderator` — admin і moderator, `moderator → member` і будь-що з `admin` — лише admin.
- Списки показують усім публічну картку; admin і moderator бачать ще `email`, `active`, `twoFactorEnabled`, `createdAt`.
- Нова адреса аватара містить `?v=<час>`, тож браузер не показує старий з кешу.

### ТЗ

    todo (Вільне) → queued (В черзі) → in_progress (В роботі) → review (На перевірці) → done (Виконано)
                                              ↑──────── return (з коментарем) ─────────┘

- Виконавців не призначають: беруть самі (`take`) у `todo` і `queued`, поки є місця; перший переводить ТЗ у `queued`.
- `start` — будь-який виконавець; після цього приєднатися не можна. `leave` — у `queued` чи `in_progress`; якщо пішов останній, ТЗ знову `todo`.
- `submit` → `review`; `return { body }` → `in_progress` з обов'язковим коментарем; `accept` → `done` і бали.
- Бали діляться порівну, остача — по балу тим, хто взяв раніше; нульові частки не записуються.
- `GET /api/tasks?status=&mine=true&limit=` — масив; для `done` спершу останні виконані.

### Бали й дисципліна

- Книга балів лише доповнюється; зняття (`POST /api/points/:id/revoke { reason }`) додає компенсаційний запис. Знімається лише ручне нарахування.
- Штраф (`type: fine`, `amount`) одразу знімає бали; зняття штрафу їх повертає. Записи не видаляються, а позначаються `revoked`.
- Рейтинг (`/api/points/leaderboard?period=month|all`): однакова сума — однакове місце, заблокованих немає,
  місяць — календарний за Києвом, зняті записи не враховуються.
- Учасник бачить лише свої записи дисципліни (`/api/discipline/me`).

### Обладнання

- Сеанс: `safetyConfirmed: true` обов'язково, час ставить сервер. admin і moderator можуть без допуску.
  Під час чужого бронювання почати не можна (`PLACE_BOOKED`), крім admin.
- Сервер раз на 10 хвилин закриває сеанси, довші за 12 годин (`SESSION_AUTO_CLOSE_HOURS`): кінець = початок + 12 год, `autoClosed: true`.
- `GET /api/places/:id/sessions/recent` — останні 10 сеансів для всіх, без нотаток.
- Журнал: `GET /api/work-sessions/export.csv` (UTF-8 з BOM, для Excel) і `/report` (сторінка A4 для друку) — admin і moderator,
  фільтри `from`, `to`, `placeId`, `userId`, без періоду — поточний місяць, до 5000 сеансів.
- Бронювання: не в минулому (допуск 5 хв), до 12 годин, до 60 днів наперед, лише для обладнання в роботі; member — лише з допуском,
  що діє до кінця слоту. Перетини неможливі навіть за одночасних запитів (гарантує база); суміжні слоти дозволені.
- Несправність: `open → in_progress → closed`; `maintenance` — одна дія «в роботі + обладнання на обслуговування»;
  `close { resolution, reactivatePlace }` може одразу повернути обладнання в роботу. До 3 фото.
- Допуск: `POST /api/place-authorizations { userId, placeId, expiresAt?, note? }`; повторна видача оновлює термін.

### Склад, документи, проєкти

- Залишок змінюється лише рухами (`POST /api/inventory/items/:id/movements { delta, note, projectId?, idempotencyKey }`).
  Брати й поповнювати можуть усі; `?lowStock=true` — позиції з низьким залишком.
- Документ: нова версія не змінює попередні; `DELETE` лише архівує. `download?inline=1` показує PDF у застосунку
  (вбудувати можуть лише його сторінки); інші типи лише завантажуються. Доступ `members` або `supervisors`.
- Проєкт: етапи `idea`, `planning`, `execution`, `review`, `done`; архів — `DELETE`. member редагує лише свої проєкти і не змінює склад учасників.

### Розумна лабораторія

- `GET /api/smart/entities` — дозволені пристрої зі станом: світло (`on`, `brightness` у %), датчики (`value`, `unit`, `deviceClass`),
  сцени. `:id` — це id зі списку, а не назва пристрою в HA.
- `POST /api/smart/lights/:id/state { on, brightness? }` повертає новий стан; `POST /api/smart/scenes/:id/activate`. Ліміт — 30 дій на хвилину.
- Список дозволених (admin): `status`, `discover` (пристрої HA, яких ще немає в списку), `allowlist` (додати, змінити назву, кімнату, `enabled`, прибрати).

### Розширена панель

- Лише порт 3001, admin із сесією 2FA. `overview` (метрики, контейнери, останній бекап), `logs?lines=` (до 500).
- Дії (`backup`, `restore-check`, `restart { target: api | ha }`) відповідають 202 із задачею; стан — `GET /api/admin-panel/jobs/:id`
  (`running`, `succeeded`, `failed`, до 100 рядків виводу). Одночасно — лише одна дія. Після перезапуску API клієнт має чекати й повторювати.

### Аудит

- `GET /api/audit?action=&actorId=&entity=&before=&limit=` (admin) — масив, нові спершу. `action` — точна дія (`user.updated`)
  або група з крапкою (`user.`). Наступна сторінка — `before=<id останнього запису>`, без пропусків.
  `actorId: null` — дія самого сервера (наприклад, автозакриття сеансу).
