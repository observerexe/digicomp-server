# API DigiComp HUB — довідник для фронтенду

Цей файл описує все, що вміє бекенд станом на етап 7 з `docs/PLAN.md`. Нові зміни додаються сюди ж.
Контракт `/auth` не змінювався. `/tasks` перероблено на етапі 2: `PATCH /tasks/:id/status` і `assigneeIds` прибрано, замість них окремі дії (див. «ТЗ»). Старий фронт ТЗ через новий API не працюватиме.

## Загальні правила

- **З етапу 7 усі шляхи API починаються з `/api`.** У таблицях нижче префікс опущено: `/tasks` означає `/api/tasks`, `/auth/login` — `/api/auth/login`. Виняток — `/health`, він лишився в корені. Решту адрес (`/`, `/tasks`, `/lab/...`) займають сторінки вебзастосунку.

- Базова адреса: `http://127.0.0.1:3000` (локально). Усі дати в ISO 8601, UTC.
- Статуси успіху: `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all` повертають 200; `POST`, що створюють об'єкт (`/users`, `/places`, `/documents`, `/projects` тощо), повертають 201; `GET`, `PATCH`, `DELETE` повертають 200.
- Авторизація: заголовок `Authorization: Bearer <accessToken>`. Токен доступу живе 1 годину.
- Вебклієнт: якщо запит містить заголовок `X-DC-Client: web`, `POST /auth/login` і `/auth/refresh` ставлять HttpOnly-cookie замість повернення токенів у тілі, а `/auth/refresh` і `/auth/logout` беруть refresh-токен із cookie. Запити, що змінюють дані, за cookie-входу мають нести цей самий заголовок (інакше 403 `CSRF`). Деталі: `docs/WEB_UA.md`.
- Оновлення сеансу: `POST /auth/refresh` з `{"refreshToken":"..."}`. Кожен refresh-токен одноразовий: у відповіді приходить новий, старий перестає діяти. Токен живе 30 днів. Повторне використання старого токена закриває всі сеанси цього входу.
- Вихід: `POST /auth/logout` з refresh-токеном (цей пристрій) або `POST /auth/logout-all`.
- Ролі: `admin`, `moderator`, `member` (етап 1: `coordinator` перейменовано на `moderator`, `guest` прибрано, колишні гості стали заблокованими `member`). Повна матриця прав: `docs/PLAN.md`, розділ «Ролі та права». У коді всі правила зібрано в `api/src/auth/policy.ts`.
- Права дивіться в `permissions` у відповіді `GET /auth/me`: це список дій (`users.create`, `documents.manage`, `smart.control` тощо), які роль може виконувати. Обмеження, що залежать від цілі (модератор діє лише над `member`, не нараховує бали собі, не приймає власне ТЗ), перевіряє сервер. Остаточно права завжди перевіряє сервер.
- Модератор не діє над іншим модератором чи адміном і над собою через `/users/:id` (403 `TARGET_ROLE_FORBIDDEN` або `SELF_ACTION_FORBIDDEN`). Свій профіль кожен змінює через `/users/me`.
- Блокування користувача (`active:false`) діє одразу: його токени перестають працювати.
- Списки повертають `{ "items": [], "total": 0, "page": 1, "limit": 50 }` (`page`, `limit` у query; `limit` до 100–200). Винятки: `/places`, `/tasks`, `/discipline/me` повертають масив, `/auth/*` і `/points` мають свій формат.
- Файли: `multipart/form-data`, поле `file`. Дозволено pdf, png, jpg, webp, docx, xlsx, pptx, txt, md, csv. Документи й матеріали проєктів до 20 МБ, аватари до 2 МБ (png, jpg, webp). Тип перевіряється за вмістом.
- Картинки й файли віддаються лише з `Authorization`, тому `<img src>` і прості посилання не працюють: завантажуйте через `fetch` і показуйте як blob.
- Ідемпотентність: у `POST /places/:id/sessions` і `POST /inventory/items/:id/movements` можна передати `idempotencyKey` (8–64 символи). Повторна відправка з тим самим ключем поверне той самий результат без дубля. Генеруйте новий ключ для кожної дії користувача.
- Ліміти запитів (на хвилину): 300 запитів на авторизованого користувача (рахується за перевіреним токеном, а не за IP, тому команда за одним шлюзом чи NAT не ділить ліміт), 10 спроб входу на одну пошту, 20 викликів `refresh`/`logout` на один refresh-токен, 5 для `setup`. Запити без дійсного токена рахуються за IP. Заголовку `X-Forwarded-For` сервер за замовчуванням не довіряє; якщо перед API з'явиться власний reverse proxy, задайте змінну `TRUST_PROXY` (наприклад `1` або `loopback`).

## Помилки

Формат: `{ "statusCode": 409, "errorCode": "INSUFFICIENT_STOCK", "message": "Insufficient stock" }`.
Для помилок валідації `message` може бути масивом рядків. Орієнтуйтеся на `errorCode`, а не на текст `message`.

Загальні коди: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `FILE_TOO_LARGE` (413), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503).
Інші `*_NOT_FOUND` будуються від назви об'єкта: `PLACE_NOT_FOUND`, `USER_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `ITEM_NOT_FOUND`, `PROJECT_NOT_FOUND`, `SESSION_NOT_FOUND`, `TASK_NOT_FOUND`, `FILE_NOT_FOUND`, `VERSION_NOT_FOUND`, `AUTHORIZATION_NOT_FOUND`.

Спеціальні коди:

| Код | Статус | Коли |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Невірні пошта чи пароль, або користувача заблоковано |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh-токен недійсний, прострочений або вже використаний |
| `INVALID_CURRENT_PASSWORD` | 400 | Неправильний поточний пароль при зміні |
| `EMAIL_TAKEN` | 409 | Пошта вже використовується |
| `LAST_ADMIN` | 409 | Спроба понизити чи заблокувати останнього адміна |
| `PLACE_CODE_TAKEN`, `ITEM_CODE_TAKEN` | 409 | Код місця чи позиції вже існує |
| `AUDIT_CURSOR_NOT_FOUND` | 404 | `before` у `GET /audit` вказує на запис, якого немає |
| `PLACE_IN_USE` | 409 | Місце зайняте (ексклюзивне) |
| `PLACE_UNAVAILABLE` | 409 | Місце на обслуговуванні чи в архіві |
| `NOT_AUTHORIZED_FOR_PLACE` | 403 | Немає чинного допуску |
| `ACTIVE_SESSION_EXISTS` | 409 | У користувача вже є активний сеанс |
| `SAFETY_CONFIRMATION_REQUIRED` | 400 | Не підтверджено техніку безпеки |
| `SESSION_ALREADY_ENDED` | 409 | Сеанс уже завершено |
| `NOT_YOUR_SESSION` | 403 | Чужий сеанс може завершити лише admin або moderator |
| `PLACE_BOOKED` | 409 | Зараз іде чуже бронювання цього обладнання. Почати сеанс може лише власник слоту (або admin) |
| `BOOKING_OVERLAP` | 409 | Час перетинається з іншим бронюванням цього обладнання |
| `BOOKING_IN_PAST`, `BOOKING_TOO_LONG`, `BOOKING_TOO_FAR` | 400 | Бронювання в минулому, довше 12 годин або далі ніж на 60 днів |
| `BOOKING_CANCELLED`, `BOOKING_ENDED` | 409 | Бронювання вже скасоване або вже минуло |
| `INVALID_PERIOD` | 400 | Кінець періоду раніше початку (або календар довший за 62 дні) |
| `EXPORT_TOO_LARGE` | 400 | Понад 5000 сеансів у вивантаженні: звузьте період |
| `FAULT_CLOSED` | 409 | Звіт про несправність уже закрито |
| `FAULT_PHOTO_LIMIT` | 409 | До звіту вже додано 3 фото |
| `PROJECT_DATES_INVALID` | 400 | Дедлайн проєкту раніше дати початку |
| `TWO_FACTOR_INVALID_CODE` | 403 | Неправильний або вже використаний код 2FA чи код відновлення |
| `TWO_FACTOR_LOCKED` | 403 | 10 неправильних кодів поспіль: перевірка заблокована на 15 хвилин |
| `TWO_FACTOR_CHALLENGE_INVALID` | 401 | `challengeToken` невалідний або минуло 5 хвилин: увійдіть знову |
| `TWO_FACTOR_CODE_REQUIRED` | 400 | Не передано ні `code`, ні `recoveryCode` |
| `TWO_FACTOR_ALREADY_ENABLED`, `TWO_FACTOR_NOT_ENABLED`, `TWO_FACTOR_NO_SETUP` | 409 | 2FA вже увімкнена, ще не увімкнена або не було кроку `setup` |
| `TWO_FACTOR_NOT_CONFIGURED` | 503 | На сервері немає `TOTP_KEY` |
| `TWO_FACTOR_REQUIRED` | 403 | Розширена панель доступна лише після входу з кодом 2FA |
| `AGENT_UNAVAILABLE` | 503 | Агент на сервері не відповідає (не встановлений, зупинений, інший токен) |
| `AGENT_BUSY` | 409 | На сервері вже виконується інша дія з панелі |
| `FORBIDDEN` | 403 | Роль не має права на цю дію (за матрицею) |
| `TARGET_ROLE_FORBIDDEN` | 403 | Модератор намагається діяти над модератором чи адміном |
| `SELF_ACTION_FORBIDDEN` | 403 | Дія над собою заборонена: модератор через `/users/:id`, нарахування балів собі, прийняття власного ТЗ |
| `FIELD_NOT_ALLOWED` | 403 | У `PATCH /users/me` змінено поле, яке роль не може змінювати собі; у тілі є `field` |
| `NOT_ALLOWED` | 403 | Завантажити аватар можна лише собі; видалити чужий може лише admin |
| `REASON_REQUIRED` | 400 | Для завершення чужого сеансу чи скасування чужого бронювання потрібна причина |
| `INSUFFICIENT_STOCK` | 409 | Недостатньо залишку на складі |
| `INTEGER_REQUIRED` | 400/409 | Для цієї одиниці кількість має бути цілою |
| `DELTA_ZERO`, `NOTE_REQUIRED` | 400 | Нульовий рух або порожній коментар |
| `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_CONTENT_MISMATCH` | 400 | Проблеми з завантаженим файлом |
| `PROJECT_EDIT_FORBIDDEN`, `PROJECT_MEMBERS_FORBIDDEN` | 403 | Немає прав редагувати проєкт чи склад учасників |
| `UNKNOWN_PLACE`, `UNKNOWN_MEMBER` | 400/404 | Посилання на неіснуючий або неактивний об'єкт. Для балів і дисципліни `UNKNOWN_MEMBER` приходить з 404 |
| `TASK_ALREADY_COMPLETED` | 409 | ТЗ уже виконано: жодних змін і переходів |
| `TASK_FULL` | 409 | Досягнуто ліміту виконавців (`maxAssignees`) |
| `TASK_ALREADY_TAKEN` | 409 | Ви вже серед виконавців |
| `TASK_ALREADY_STARTED` | 409 | Роботу почато, приєднатись уже не можна |
| `TASK_INVALID_TRANSITION` | 409 | Дія не підходить до поточного статусу (наприклад, здати ТЗ «в черзі») |
| `TASK_HAS_ASSIGNEES` | 409 | Видалити можна лише вільне ТЗ без виконавців |
| `MAX_ASSIGNEES_TOO_LOW` | 409 | Ліміт виконавців менший за кількість тих, хто вже взяв ТЗ |
| `NOT_PARTICIPANT` | 403 | Дію (почати, здати, відмовитись, додати файл) може виконати лише виконавець ТЗ |
| `NOT_OWNER` | 403 | Модератор знімає лише записи, які видав сам |
| `ALREADY_REVOKED` | 409 | Запис уже знято |
| `ENTRY_NOT_REVOCABLE` | 409 | Через `/points/:id/revoke` знімається лише ручне нарахування. Бали за ТЗ остаточні, штраф знімається через `/discipline` |
| `FINE_AMOUNT_REQUIRED`, `AMOUNT_ONLY_FOR_FINE` | 400 | `amount` обов'язковий для штрафу і заборонений для попередження чи догани |
| `SETUP_ALREADY_COMPLETED` | 409 | Першого адміна вже створено |
| `SMART_NOT_CONFIGURED`, `SMART_UNAVAILABLE`, `SMART_AUTH_FAILED` | 503 | Home Assistant не налаштований, не відповідає за 5 секунд або відхилив токен |
| `UNKNOWN_HA_ENTITY`, `ENTITY_KIND_MISMATCH`, `SMART_ENTITY_EXISTS` | 400/409 | Додавання пристрою в дозволений список: такого пристрою немає в HA, не збігається тип, або він уже доданий |
| `SMART_DEVICE_NOT_FOUND` | 404 | Пристрою немає у списку, він прихований або іншого типу (наприклад, `binary_sensor` на адресі світла) |
| `DEVICE_UNAVAILABLE` | 409 | Пристрій у HA недоступний (вимкнений чи без зв'язку) |
| `BRIGHTNESS_REQUIRES_ON` | 400 | Яскравість можна задавати лише разом із `on: true` |

## Ендпоінти

### Стан сервера

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/health` | публічний |

### Авторизація

| Метод | Шлях | Хто має доступ |
|---|---|---|
| POST | `/auth/setup` | публічний (лише поки немає користувачів) |
| POST | `/auth/login` | публічний |
| POST | `/auth/refresh` | публічний (за refresh-токеном) |
| POST | `/auth/logout` | публічний (за refresh-токеном) |
| POST | `/auth/logout-all` | будь-який авторизований |
| GET | `/auth/me` | будь-який авторизований |
| POST | `/auth/2fa/verify` | публічний (за `challengeToken` з `/auth/login`) |
| POST | `/auth/2fa/setup` | будь-який авторизований (свій акаунт) |
| POST | `/auth/2fa/enable` | будь-який авторизований |
| POST | `/auth/2fa/disable` | будь-який авторизований |
| POST | `/auth/2fa/recovery-codes` | будь-який авторизований |

### Користувачі

| Метод | Шлях | Хто має доступ |
|---|---|---|
| POST | `/users` | admin, moderator (створюється лише `member`) |
| GET | `/users` | admin, moderator, member |
| PATCH | `/users/me` | admin, moderator, member |
| PATCH | `/users/me/password` | admin, moderator, member |
| GET | `/users/:id` | admin, moderator, member |
| POST | `/users/:id/avatar` | лише власний аватар |
| DELETE | `/users/:id/avatar` | власний; чужий лише admin |
| PATCH | `/users/:id` | admin; moderator лише над `member` і лише деякі поля (див. нижче) |
| POST | `/users/:id/reset-password` | admin |
| POST | `/users/:id/2fa/reset` | admin |

### ТЗ (дошка завдань)

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/tasks` | admin, moderator, member |
| GET | `/tasks/:id` | admin, moderator, member |
| POST | `/tasks` | admin, moderator |
| PATCH | `/tasks/:id` | admin, moderator |
| DELETE | `/tasks/:id` | admin, moderator (лише вільне без виконавців) |
| POST | `/tasks/:id/take` | admin, moderator, member |
| POST | `/tasks/:id/leave` | виконавець |
| POST | `/tasks/:id/start` | виконавець |
| POST | `/tasks/:id/submit` | виконавець |
| POST | `/tasks/:id/return` | admin; moderator, якщо він не виконавець |
| POST | `/tasks/:id/accept` | admin; moderator, якщо він не виконавець |
| POST | `/tasks/:id/comments` | admin, moderator, member |
| POST | `/tasks/:id/files` | admin, moderator; member, якщо він виконавець |
| GET | `/tasks/:id/files/:fileId/download` | admin, moderator, member |
| DELETE | `/tasks/:id/files/:fileId` | автор файлу, admin, moderator |

### Бали і рейтинг

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/points/me` | admin, moderator, member |
| GET | `/points/leaderboard` | admin, moderator, member |
| GET | `/points/users/:userId` | admin, moderator |
| POST | `/points/award` | admin; moderator, не собі |
| POST | `/points/:entryId/revoke` | admin; moderator лише своє нарахування |

### Дисципліна

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/discipline/me` | admin, moderator, member (лише свої записи) |
| GET | `/discipline` | admin, moderator |
| POST | `/discipline` | admin; moderator, не собі |
| POST | `/discipline/:id/revoke` | admin; moderator лише свій запис |

### Місця (QR-паспорти)

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/places` | admin, moderator, member |
| GET | `/places/:id` | admin, moderator, member |
| POST | `/places` | admin, moderator |
| PATCH | `/places/:id` | admin, moderator |
| GET | `/places/:id/sessions/recent` | admin, moderator, member |
| POST | `/places/:id/sessions` | admin, moderator, member |

### Журнал користування

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/work-sessions` | admin, moderator, member |
| PATCH | `/work-sessions/:id/end` | admin, moderator, member |
| GET | `/work-sessions/export.csv` | admin, moderator |
| GET | `/work-sessions/report` | admin, moderator |

### Бронювання

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/places/:id/bookings` | admin, moderator, member |
| GET | `/bookings/me` | admin, moderator, member |
| POST | `/bookings` | admin, moderator; member, якщо має допуск (коли він потрібен) |
| POST | `/bookings/:id/cancel` | своє — усі; чуже — admin, moderator (з причиною) |

### Несправності

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/faults` | admin, moderator, member |
| GET | `/faults/:id` | admin, moderator, member |
| POST | `/faults` | admin, moderator, member |
| POST | `/faults/:id/photos` | автор звіту, admin, moderator |
| GET | `/faults/:id/photos/:photoId` | admin, moderator, member |
| POST | `/faults/:id/in-progress` | admin, moderator |
| POST | `/faults/:id/maintenance` | admin, moderator |
| POST | `/faults/:id/close` | admin, moderator |

### Допуски

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/place-authorizations` | admin, moderator, member |
| POST | `/place-authorizations` | admin, moderator |
| DELETE | `/place-authorizations/:id` | admin, moderator |

### Документи

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/documents` | admin, moderator, member |
| GET | `/documents/:id` | admin, moderator, member |
| GET | `/documents/:id/versions` | admin, moderator, member |
| GET | `/documents/:id/download` | admin, moderator, member |
| POST | `/documents` | admin, moderator |
| POST | `/documents/:id/files` | admin, moderator |
| PATCH | `/documents/:id` | admin, moderator |
| DELETE | `/documents/:id` | admin, moderator (архівує) |

### Файли

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/files/avatars/:userId` | admin, moderator, member |

### Склад

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/inventory/items` | admin, moderator, member |
| GET | `/inventory/items/:id` | admin, moderator, member |
| POST | `/inventory/items` | admin, moderator |
| PATCH | `/inventory/items/:id` | admin, moderator |
| POST | `/inventory/items/:id/movements` | admin, moderator, member |
| GET | `/inventory/movements` | admin, moderator, member |
| GET | `/inventory/export` | admin, moderator |

### Проєкти

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/projects` | admin, moderator, member |
| GET | `/projects/:id` | admin, moderator, member |
| GET | `/projects/:id/history` | admin, moderator, member |
| POST | `/projects` | admin, moderator |
| PATCH | `/projects/:id` | admin, moderator, member |
| DELETE | `/projects/:id` | admin, moderator (архівує) |
| POST | `/projects/:id/files` | admin, moderator, member |
| GET | `/projects/:id/files/:fileId/download` | admin, moderator, member |
| DELETE | `/projects/:id/files/:fileId` | admin, moderator |

### Розумний будинок (Home Assistant)

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/smart/entities` | admin, moderator, member |
| POST | `/smart/lights/:id/state` | admin, moderator |
| POST | `/smart/scenes/:id/activate` | admin, moderator |
| GET | `/smart/status` | admin |
| GET | `/smart/discover` | admin |
| GET | `/smart/allowlist` | admin |
| POST | `/smart/allowlist` | admin |
| PATCH | `/smart/allowlist/:id` | admin |
| DELETE | `/smart/allowlist/:id` | admin |

### Розширена панель (лише порт 3001, див. `docs/ADMIN_PANEL_UA.md`)

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/admin-panel/overview` | admin з сесією 2FA |
| GET | `/admin-panel/logs` | admin з сесією 2FA |
| POST | `/admin-panel/actions/backup` | admin з сесією 2FA |
| POST | `/admin-panel/actions/restore-check` | admin з сесією 2FA |
| POST | `/admin-panel/actions/restart` | admin з сесією 2FA |
| GET | `/admin-panel/jobs/:id` | admin з сесією 2FA |

**Двофакторний вхід (2FA).**
- Коди з застосунку-автентифікатора (TOTP: 6 цифр, 30 секунд). Підходять Aegis, Google Authenticator, 1Password тощо. Увімкнути 2FA може кожен; для розширеної панелі вона обов'язкова.
- **Увімкнення:**
  - `POST /auth/2fa/setup` повертає `{ secret, otpauthUri }`. З `otpauthUri` фронт малює QR. Поки 2FA не підтверджена, вона не діє.
  - `POST /auth/2fa/enable { code }` повертає `{ recoveryCodes: [8 кодів] }`. Коди показуються лише раз.
  - Після увімкнення всі сесії користувача закриваються: увійти треба знову, тепер із кодом.
- **Вхід:**
  - якщо 2FA увімкнена, `POST /auth/login` відповідає 200 з `{ twoFactorRequired: true, challengeToken }`, без токенів і cookie;
  - далі `POST /auth/2fa/verify { challengeToken, code }` або `{ challengeToken, recoveryCode }` повертає те саме, що звичайний вхід (токени або cookie для `X-DC-Client: web`);
  - `challengeToken` діє 5 хвилин і не працює як токен доступу.
- **Захист від підбору і повторів:**
  - кожен код приймається лише раз; код, старший за вже використаний, теж не приймається;
  - код відновлення одноразовий, у базі зберігаються лише хеші;
  - після 10 неправильних кодів поспіль перевірка блокується на 15 хвилин (`TWO_FACTOR_LOCKED`);
  - на `/auth/2fa/verify` діє ліміт 5 спроб на хвилину.
- `POST /auth/2fa/disable { code | recoveryCode }` вимикає 2FA. `POST /auth/2fa/recovery-codes { code }` видає новий набір кодів відновлення, старі перестають діяти.
- `POST /users/:id/2fa/reset` (admin) скидає 2FA людині, яка загубила телефон, і закриває її сесії. Пишеться в аудит.
- У `GET /auth/me` і в розширеному профілі є `twoFactorEnabled`.
- Секрет 2FA зашифровано в базі ключем `TOTP_KEY`. Без цього ключа на сервері 2FA не вмикається (503 `TWO_FACTOR_NOT_CONFIGURED`).

**Розширена панель.**
- Працює лише на панельному порту (`PANEL_PORT`, за замовчуванням 3001), відкритому через `tailscale serve`. На основному порту ці шляхи відповідають 404.
- Потрібен `admin` у сесії, де вхід був із кодом 2FA. Інакше 403 `TWO_FACTOR_REQUIRED`. Якщо 2FA вимкнули, такі сесії теж перестають підходити.
- `GET /admin-panel/overview` повертає:
  - `metrics`: `cpuPercent`, `cpuCount`, `load`, `memory { totalBytes, usedBytes, availableBytes }`, `disks [{ path, totalBytes, usedBytes, freeBytes }]`, `uptimeSeconds`;
  - `containers`: `[{ name: "api" | "db" | "homeassistant", state, health, status }]`;
  - `lastBackup`: `{ found, count, file, sizeBytes, at }`.
- `GET /admin-panel/logs?lines=200` (1–500): `{ lines: [] }`, останні рядки логу API.
- Дії відповідають 202 з задачею `{ id, action, status: "running", startedAt }`:
  - `POST /admin-panel/actions/backup` і `/actions/restore-check`;
  - `/actions/restart { target: "api" | "ha" }` — базу з панелі не перезапустити.

  Одночасно виконується лише одна дія, інакше 409 `AGENT_BUSY`.
- `GET /admin-panel/jobs/:id` повертає статус задачі: `running`, `succeeded` або `failed`, `exitCode` і до 100 останніх рядків `output`. Після перезапуску API фронт має кілька секунд чекати і повторювати запит.
- Кожна дія пишеться в аудит (`panel.action`). Метрики, логи й дії дає агент на сервері; якщо він не відповідає — 503 `AGENT_UNAVAILABLE`.

### Аудит

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/audit` | admin |

`GET /audit?action=&actorId=&entity=&before=&limit=`: записи, нові спершу, масив.
- `action`: точна дія (`user.updated`) або група з крапкою в кінці (`user.` — усі дії з учасниками).
- `actorId`: хто діяв. `entity`: тип об'єкта (`user`, `place`, `task`…).
- `limit` 1–200, за замовчуванням 100. Наступна сторінка: `before=<id останнього показаного запису>`, без пропусків навіть для записів з однаковим часом. Якщо запису з таким `before` немає — 404 `AUDIT_CURSOR_NOT_FOUND`.
- Поля запису: `id`, `actorId` (`null` — дія самого сервера, наприклад автозакриття сеансу), `actor: { id, name } | null`, `action`, `entity`, `entityId`, `meta`, `createdAt`.
- Аудит працює на будь-якому порту, 2FA для нього не потрібна: він лише для читання й лише для admin.

### Документація API (OpenAPI)

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/docs` | admin (сторінка Swagger UI) |
| GET | `/docs/openapi.json` | admin |

Сторінка відкривається в браузері за cookie-входом (або з `Authorization`). Для фронту схему зберігають у файл без запуску сервера й бази: `cd api && npm run build && npm run openapi` записує `api/openapi.json`. Схеми тіл запитів будуються з DTO. Схеми відповідей (класи `*/responses.dto.ts`) додаються разом із розділами фронту; сервіси повертають ці типи, тож розбіжність ловить компілятор. Уже описані: `auth/me`, `auth/2fa/*`, `users` (створення, список, картка, зміна, `me`, пароль, скидання пароля й 2FA, аватар), `points/me`, `points/leaderboard`, `points/users/:id`, `discipline`, `discipline/me`, `bookings` (створення, скасування, `me`), `places` (список, картка, останні сеанси, старт сеансу), `places/:id/bookings`, `place-authorizations` (список, видача, відкликання), `work-sessions` (список, завершення), `faults` (усі дії), `documents` (список), `tasks` (усі дії, картка з коментарями й файлами), `projects`, `admin-panel` (огляд, логи, дії, задачі), `audit`.

## Основні поля запитів

**Користувачі.** `PATCH /users/me`: `bio` (усі), `position` і `specialty` (admin, moderator), `name` (лише admin). Якщо поле, яке роль не може змінювати, надіслано з тим самим значенням, помилки немає. Змінене значення дає 403 `FIELD_NOT_ALLOWED`. `PATCH /users/:id`: `name`, `email`, `bio` змінює лише admin; `position`, `specialty`, `active` змінюють admin і moderator (moderator лише в `member`); `role`: `member → moderator` можуть admin і moderator, `moderator → member` лише admin, видати чи забрати `admin` лише admin. Кожна зміна пишеться в аудит (`user.updated`), створення учасника теж (`user.created`). `PATCH /users/me/password`: `currentPassword`, `newPassword` (від 8 символів). `POST /users/:id/reset-password` (admin): `newPassword`. Після зміни чи скидання пароля всі refresh-сеанси закриваються. `POST /users/:id/avatar`: multipart, поле `file`. Після цього `avatarUrl` дорівнює `/api/files/avatars/<id>?v=<час>`: версія змінюється з кожним новим аватаром, тож браузер не показує старий з кешу. Старі адреси `/files/avatars/<id>` міграція `AvatarUrlUnderApi` переводить під `/api`.
`GET /users`: фільтри `search`, `role`, `active`, `page`, `limit`. Усі бачать публічну картку: `id`, `name`, `role`, `position`, `specialty`, `bio`, `avatarUrl`. Admin і moderator додатково бачать `email`, `active`, `twoFactorEnabled`, `createdAt`. `GET /users/:id` до цього додає `pointsTotal`.

**Місця.** `POST /places`: `code` (латиниця, цифри, `_`, `-`, 3–60), `title`, `category`, `location`, `description`, `needsAuthorization` (за замовчуванням true), `exclusive` (за замовчуванням true). `status`: `active`, `maintenance`, `archived`. У шляху `:id` можна передавати uuid або код (наприклад `SOLDER-01`): так працюють QR-посилання. У відповіді: `inUse`, `activeSessions`, `myAuthorization`.

**Сеанси.** `POST /places/:id/sessions`: `safetyConfirmed: true` (обов'язково), `note`, `idempotencyKey`. Час початку ставить сервер, користувач береться з токена. `PATCH /work-sessions/:id/end`: `note`, `equipmentState`, `reason` (обов'язкова, якщо завершує не власник). `GET /work-sessions`: `placeId`, `userId`, `active`, `from`, `to`; member бачить лише свої. `GET /places/:id/sessions/recent` (id або QR-код): останні 10 сеансів на обладнанні для всіх — `{ id, startedAt, endedAt, autoClosed, user: { id, name, avatarUrl } }`, без нотаток і причин; архівне обладнання для member дає 404. Admin і moderator можуть починати сеанс без допуску. Якщо зараз іде чуже бронювання, сеанс почати не можна (409 `PLACE_BOOKED`); admin може.

**Автозакриття.** Сервер раз на 10 хвилин закриває сеанси, що тривають довше 12 годин (`SESSION_AUTO_CLOSE_HOURS`). Кінець ставиться як «початок + 12 год», у сеансі `autoClosed: true`, `endReason: "закрито автоматично"`, в аудиті `session.auto_closed` без автора.

**Вивантаження журналу** (admin, moderator). Параметри: `from`, `to` (ISO, період `[from, to)`), `placeId`, `userId`. Без періоду береться поточний місяць за київським часом. Не більше 5000 сеансів за раз.
- `GET /work-sessions/export.csv` — CSV для Excel (UTF-8 з BOM). Колонки: обладнання, код, особа, початок, кінець (київський час), тривалість год:хв, хвилин, примітка («закрито автоматично», «завершив …: причина», «триває»).
- `GET /work-sessions/report` — HTML-сторінка A4 для друку: таблиця, підсумки за обладнанням і за особами. Друкувати чи зберегти PDF можна з браузера (Ctrl+P). Сторінка має власний CSP без скриптів. Відкривається звичайним посиланням через cookie-вхід, тож фронт може відкрити її в новій вкладці.

**Бронювання.**
- `POST /bookings`: `{ placeId, startsAt, endsAt, note? }`.
  - Не в минулому (допуск 5 хвилин), не довше 12 годин, не далі ніж на 60 днів вперед, лише для обладнання в стані `active`.
  - Member бронює лише обладнання, на яке має допуск. Якщо допуск обмежений у часі, він має діяти до кінця бронювання.
  - Перетини неможливі навіть за одночасних запитів: це гарантує сама база. Суміжні слоти (кінець одного = початок іншого) дозволені.
- `GET /places/:id/bookings?from=&to=`: календар. Можна передати id або QR-код обладнання. За замовчуванням від учора на 15 днів, максимум 62 дні. Повертає лише активні бронювання.
- `GET /bookings/me`: мої поточні й майбутні бронювання.
- `POST /bookings/:id/cancel`: `{ reason? }`. Своє бронювання скасовує кожен. Чуже скасовують admin і moderator, `reason` обов'язкова, в аудит пишеться `booking.cancelled` з `forced: true`.
- Поля бронювання: `id`, `startsAt`, `endsAt`, `note`, `createdAt`, `cancelled`, `cancelledAt`, `cancelledById`, `cancelReason`, `user: { id, name, avatarUrl }`, `place: { id, code, title }`.

**Несправності.**
- `POST /faults`: `{ placeId, description }`. Статуси: `open → in_progress → closed`.
- `POST /faults/:id/photos`: multipart, поле `file`, png/jpg/webp до 5 МБ, не більше 3 фото. Додає автор звіту або admin/moderator, лише поки звіт не закрито.
- `GET /faults/:id/photos/:photoId`: показ фото.
- `POST /faults/:id/in-progress`: звіт «в роботі», обладнання не зупиняється.
- `POST /faults/:id/maintenance`: одна дія — звіт «в роботі», а обладнання переходить на обслуговування (`maintenance`). На обладнанні на обслуговуванні не можна почати сеанс чи забронювати його.
- `POST /faults/:id/close`: `{ resolution, reactivatePlace? }`. З `reactivatePlace: true` обладнання з обслуговування одразу повертається в роботу.
- `GET /faults?placeId=&status=&page=&limit=`: список, у кожного звіту `photosCount`. `GET /faults/:id` додатково повертає `photos`.
- Поля звіту: `id`, `description`, `status`, `resolution`, `place: { id, code, title, status }`, `reporter`, `closedBy`, `closedAt`, `createdAt`, `updatedAt`.

**Допуски.** `POST /place-authorizations`: `userId`, `placeId`, `expiresAt` (необов'язково), `note`. Повторна видача оновлює термін.

**Документи.** `POST /documents` (multipart): `title`, `category`, `description`, `accessScope` (`members` або `supervisors`), `placeId`, `inventoryItemId`, `file`. `POST /documents/:id/files`: нова версія (`file`, `changeNote`), попередні версії не змінюються. `GET /documents/:id/download?version=N`. З `&inline=1` PDF віддається для перегляду в застосунку: `Content-Disposition: inline`, вбудовувати його можуть лише сторінки застосунку (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`), а сам файл нічого не завантажує (`default-src 'none'`). Інші типи `inline` ігнорують і лише завантажуються. `DELETE /documents/:id` лише архівує. У списку `GET /documents`: `search`, `category`, `placeId`, `inventoryItemId`.

**Склад.** `POST /inventory/items`: `code`, `title`, `category`, `unit` (за замовчуванням `шт`), `quantity` (початковий залишок), `minQuantity`, `location`, `notes`. Кількість напряму не змінюється: лише `POST /inventory/items/:id/movements` з `delta` (від'ємне чи додатне, до 3 знаків), `note` (обов'язково), `projectId`, `idempotencyKey`. Брати (`delta` менше нуля) і поповнювати (`delta` більше нуля) можуть усі ролі. Для одиниць `шт`, `pcs`, `уп` кількість лише ціла. У позиції є `lowStock` і `documentsCount`, у `GET /inventory/items/:id` ще й список прив'язаних документів. `:id` у `GET` — id або код позиції (з QR-наліпки, без різниці в регістрі). `GET /inventory/items?lowStock=true` показує позиції з низьким залишком.

**Проєкти.** `POST /projects` (admin, moderator): `title`, `description`, `stage`, `startDate`, `deadline`, `progress` (0–100), `accomplishments`, `sources` (масив рядків), `memberIds`.
- `stage` — фіксований етап: `idea` (Ідея), `planning` (Планування, за замовчуванням), `execution` (Виконання), `review` (Перевірка), `done` (Завершено). Архів — окрема дія `DELETE /projects/:id`. Вільне поле `status` прибрано на етапі 3.
- `startDate`, `deadline` — дати `YYYY-MM-DD` або `null`. Дедлайн не може бути раніше початку (`PROJECT_DATES_INVALID`).
- `GET /projects?stage=execution` фільтрує за етапом.
- `PATCH /projects/:id`: ті самі поля. Admin і moderator редагують усе, member лише проєкти, де він учасник, і не може змінювати `memberIds`. У `GET /projects/:id` є `canEdit`. `GET /projects/:id/history`: журнал змін.

**Розумний будинок.** `GET /smart/entities` повертає `{ items: [] }`; у кожного елемента є `id`, `kind` (`light`, `sensor`, `binary_sensor`, `scene`), `label`, `room`, `enabled`, `available`. Для світла додатково `on` і `brightness` (відсотки, `null`, коли вимкнене), для датчиків (`sensor` і `binary_sensor`) — `value` (стан з HA: `21.5`, `on`, `off`), `unit`, `deviceClass`. Датчик «так/ні» (`binary_sensor`: рух, протікання, двері) лише показується, керувати ним не можна. `GET /smart/discover` повертає `{ items: [{ entityId, kind, name, state }] }` — пристрої HA, яких ще немає у списку. `POST /smart/lights/:id/state`: `{ "on": true, "brightness": 1-100 }`, повертає новий стан. `POST /smart/scenes/:id/activate` без тіла. Ідентифікатор `:id` це `id` елемента зі списку, а не назва пристрою в HA. Керувати можна лише світлом і сценами, розетки та вимикачі додати в список неможливо. Налаштування див. `docs/SMART_UA.md`.

**ТЗ.** Статуси і переходи:

    todo (Вільне) → queued (В черзі) → in_progress (В роботі) → review (На перевірці) → done (Виконано)
                                              ↑──────── return (повернення з коментарем) ────────┘

- `POST /tasks` (admin, moderator): `title`, `description`, `points` (0–1000), `maxAssignees` (1–20, за замовчуванням 1), `dueDate`. Виконавців не призначають: учасники беруть ТЗ самі.
- `take`: узяти ТЗ можна у статусах `todo` і `queued`, поки не досягнуто `maxAssignees`. Перший, хто взяв, переводить ТЗ з `todo` в `queued`.
- `start`: будь-який виконавець, `queued → in_progress`. Після цього приєднатись не можна (`TASK_ALREADY_STARTED`).
- `leave`: виконавець відмовляється в `queued` чи `in_progress`. Якщо пішов останній, ТЗ знову стає `todo`.
- `submit`: виконавець, `in_progress → review`.
- `return`: `{ "body": "що виправити" }`, `review → in_progress`. Коментар обов'язковий і зберігається з `kind: "return"`.
- `accept`: `review → done`. Бали діляться порівну між виконавцями, остача йде по одному балу тим, хто взяв ТЗ раніше (10 на трьох: 4, 3, 3). Нульові частки не записуються. Повторне прийняття неможливе.
- `PATCH /tasks/:id`: `title`, `description`, `points`, `maxAssignees`, `dueDate` (`null` прибирає дедлайн). Не для виконаного ТЗ.
- `DELETE /tasks/:id`: лише вільне ТЗ без виконавців.
- Усі переходи повертають оновлене ТЗ.
- `GET /tasks?status=queued&mine=true&limit=30`: масив ТЗ, нові спершу. Для `status=done` — спершу ті, що виконані останніми. `limit` (1–500) необов'язковий; дошка вантажить так останні виконані.
  - Поля ТЗ: `id`, `title`, `description`, `status`, `points`, `maxAssignees`, `dueDate`, `createdById`, `createdAt`, `updatedAt`, `completedAt`.
  - `assignees`: `[{ id, name, avatarUrl, takenAt }]` у порядку взяття.
- `GET /tasks/:id` додатково повертає `comments` (`[{ id, kind, body, author: { id, name, avatarUrl }, createdAt }]`) і `files`.
- `POST /tasks/:id/comments`: `{ "body": "..." }` (до 2000 символів).
- `POST /tasks/:id/files`: multipart, ті самі типи файлів, що й для документів, до 20 МБ.
- Усі дії з ТЗ пишуться в аудит (`task.*`).

**Бали.**
- Книга обліку лише доповнюється: записи не змінюються і не видаляються. Зняття додає компенсаційний запис.
- `GET /points/me` і `GET /points/users/:userId` повертають `{ balance, history }`:
  - `history` — до 100 останніх записів;
  - поля запису: `id`, `kind` (`task`, `manual`, `fine`, `reversal`), `amount`, `reason`, `taskId`, `taskTitle`, `reversesId`, `createdBy: { id, name } | null`, `revoked`, `createdAt`.
- `POST /points/award`: `{ userId, amount: 1–1000, reason }`. Ручне нарахування за побутові задачі. Модератор не нараховує собі. Заблокованим і невідомим користувачам не можна (404 `UNKNOWN_MEMBER`).
- `POST /points/:entryId/revoke`: `{ reason }`. Знімає лише ручне нарахування. Admin знімає будь-яке, moderator лише своє.
- `GET /points/leaderboard?period=month|all` (за замовчуванням `all`):
  - відповідь — масив `{ id, name, avatarUrl, position, total, rank }`; однакова сума дає однакове місце;
  - заблокованих у рейтингу немає;
  - `month` — поточний календарний місяць за київським часом;
  - зняті записи та їхні компенсації не враховуються в жодному періоді.
- `GET /users/:id` має поле `pointsTotal`.

**Дисципліна.**
- `POST /discipline`: `{ userId, type: "warning" | "fine" | "reprimand", reason, amount? }`.
  - `amount` (1–1000) лише для штрафу: штраф одразу знімає стільки балів.
  - Модератор може видати запис будь-кому, крім себе, зокрема іншому модератору чи адміну.
- `POST /discipline/:id/revoke`: `{ reason }`. Admin знімає будь-який запис, moderator лише свій. Знятий штраф повертає бали. Запис не видаляється, а позначається `revoked`.
- Поля запису: `id`, `type`, `reason`, `amount`, `user`, `issuedBy`, `createdAt`, `revoked`, `revokedAt`, `revokedBy`, `revokeReason`. Посилання на людей мають вигляд `{ id, name, avatarUrl }`.
- `GET /discipline/me`: власні записи, разом зі знятими. Чужих записів учасник не бачить.
- `GET /discipline?userId=&state=active|revoked|all&page=&limit=`: таблиця для панелі керування (admin, moderator).
- Видача і зняття пишуться в аудит (`discipline.issued`, `discipline.revoked`, `points.awarded`, `points.revoked`).

## Що ще не реалізовано

Home Assistant, сповіщення, імпорт команди з CSV, перенесення даних зі старого SQLite, режим cookie для PWA, прив'язка завдань до проєктів, автоматичний скан файлів на віруси.
