# API DigiComp HUB — довідник для фронтенду

Цей файл описує все, що вміє бекенд станом на етап 2 з `docs/PLAN.md`. Нові зміни додаються сюди ж.
Контракт `/auth` не змінювався. `/tasks` перероблено на етапі 2: `PATCH /tasks/:id/status` і `assigneeIds` прибрано, замість них окремі дії (див. «ТЗ»). Старий фронт ТЗ через новий API не працюватиме.

## Загальні правила

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
| `PLACE_IN_USE` | 409 | Місце зайняте (ексклюзивне) |
| `PLACE_UNAVAILABLE` | 409 | Місце на обслуговуванні чи в архіві |
| `NOT_AUTHORIZED_FOR_PLACE` | 403 | Немає чинного допуску |
| `ACTIVE_SESSION_EXISTS` | 409 | У користувача вже є активний сеанс |
| `SAFETY_CONFIRMATION_REQUIRED` | 400 | Не підтверджено техніку безпеки |
| `SESSION_ALREADY_ENDED` | 409 | Сеанс уже завершено |
| `NOT_YOUR_SESSION` | 403 | Чужий сеанс може завершити лише admin або moderator |
| `FORBIDDEN` | 403 | Роль не має права на цю дію (за матрицею) |
| `TARGET_ROLE_FORBIDDEN` | 403 | Модератор намагається діяти над модератором чи адміном |
| `SELF_ACTION_FORBIDDEN` | 403 | Дія над собою заборонена: модератор через `/users/:id`, нарахування балів собі, прийняття власного ТЗ |
| `FIELD_NOT_ALLOWED` | 403 | У `PATCH /users/me` змінено поле, яке роль не може змінювати собі; у тілі є `field` |
| `NOT_ALLOWED` | 403 | Завантажити аватар можна лише собі; видалити чужий може лише admin |
| `REASON_REQUIRED` | 400 | Для завершення чужого сеансу потрібна причина |
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
| POST | `/places/:id/sessions` | admin, moderator, member |

### Журнал користування

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/work-sessions` | admin, moderator, member |
| PATCH | `/work-sessions/:id/end` | admin, moderator, member |

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

### Аудит

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/audit` | admin |

### Документація API (OpenAPI)

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/docs` | admin (сторінка Swagger UI) |
| GET | `/docs/openapi.json` | admin |

Сторінка відкривається в браузері за cookie-входом (або з `Authorization`). Для фронту схему зберігають у файл без запуску сервера й бази: `cd api && npm run build && npm run openapi` записує `api/openapi.json`. Схеми тіл запитів будуються з DTO; схем відповідей поки немає.

## Основні поля запитів

**Користувачі.** `PATCH /users/me`: `bio` (усі), `position` і `specialty` (admin, moderator), `name` (лише admin). Якщо поле, яке роль не може змінювати, надіслано з тим самим значенням, помилки немає. Змінене значення дає 403 `FIELD_NOT_ALLOWED`. `PATCH /users/:id`: `name`, `email`, `bio` змінює лише admin; `position`, `specialty`, `active` змінюють admin і moderator (moderator лише в `member`); `role`: `member → moderator` можуть admin і moderator, `moderator → member` лише admin, видати чи забрати `admin` лише admin. Кожна зміна пишеться в аудит (`user.updated`), створення учасника теж (`user.created`). `PATCH /users/me/password`: `currentPassword`, `newPassword` (від 8 символів). `POST /users/:id/reset-password` (admin): `newPassword`. Після зміни чи скидання пароля всі refresh-сеанси закриваються. `POST /users/:id/avatar`: multipart, поле `file`. Після цього `avatarUrl` дорівнює `/files/avatars/<id>`.
`GET /users`: фільтри `search`, `role`, `active`, `page`, `limit`. Admin і moderator бачать `email`, `bio`, `active`, `createdAt`, member бачить лише `id`, `name`, `role`, `position`, `specialty`, `avatarUrl`.

**Місця.** `POST /places`: `code` (латиниця, цифри, `_`, `-`, 3–60), `title`, `category`, `location`, `description`, `needsAuthorization` (за замовчуванням true), `exclusive` (за замовчуванням true). `status`: `active`, `maintenance`, `archived`. У шляху `:id` можна передавати uuid або код (наприклад `SOLDER-01`): так працюють QR-посилання. У відповіді: `inUse`, `activeSessions`, `myAuthorization`.

**Сеанси.** `POST /places/:id/sessions`: `safetyConfirmed: true` (обов'язково), `note`, `idempotencyKey`. Час початку ставить сервер, користувач береться з токена. `PATCH /work-sessions/:id/end`: `note`, `equipmentState`, `reason` (обов'язкова, якщо завершує не власник). `GET /work-sessions`: `placeId`, `userId`, `active`, `from`, `to`; member бачить лише свої. Admin і moderator можуть починати сеанс без допуску.

**Допуски.** `POST /place-authorizations`: `userId`, `placeId`, `expiresAt` (необов'язково), `note`. Повторна видача оновлює термін.

**Документи.** `POST /documents` (multipart): `title`, `category`, `description`, `accessScope` (`members` або `supervisors`), `placeId`, `inventoryItemId`, `file`. `POST /documents/:id/files`: нова версія (`file`, `changeNote`), попередні версії не змінюються. `GET /documents/:id/download?version=N`. `DELETE /documents/:id` лише архівує. У списку `GET /documents`: `search`, `category`, `placeId`, `inventoryItemId`.

**Склад.** `POST /inventory/items`: `code`, `title`, `category`, `unit` (за замовчуванням `шт`), `quantity` (початковий залишок), `minQuantity`, `location`, `notes`. Кількість напряму не змінюється: лише `POST /inventory/items/:id/movements` з `delta` (від'ємне чи додатне, до 3 знаків), `note` (обов'язково), `projectId`, `idempotencyKey`. Брати (`delta` менше нуля) і поповнювати (`delta` більше нуля) можуть усі ролі. Для одиниць `шт`, `pcs`, `уп` кількість лише ціла. У позиції є `lowStock` і `documentsCount`, у `GET /inventory/items/:id` ще й список прив'язаних документів. `GET /inventory/items?lowStock=true` показує позиції з низьким залишком.

**Проєкти.** `POST /projects` (admin, moderator): `title`, `description`, `status`, `progress` (0–100), `accomplishments`, `sources` (масив рядків), `memberIds`. `PATCH /projects/:id`: ті самі поля. Admin і moderator редагують усе, member лише проєкти, де він учасник, і не може змінювати `memberIds`. У `GET /projects/:id` є `canEdit`. `GET /projects/:id/history`: журнал змін.

**Розумний будинок.** `GET /smart/entities` повертає `{ items: [] }`; у кожного елемента є `id`, `kind` (`light`, `sensor`, `scene`), `label`, `room`, `available`. Для світла додатково `on` і `brightness` (відсотки), для датчика `value`, `unit`, `deviceClass`. `POST /smart/lights/:id/state`: `{ "on": true, "brightness": 1-100 }`, повертає новий стан. `POST /smart/scenes/:id/activate` без тіла. Ідентифікатор `:id` це `id` елемента зі списку, а не назва пристрою в HA. Керувати можна лише світлом і сценами, розетки та вимикачі додати в список неможливо. Налаштування див. `docs/SMART_UA.md`.

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
- `GET /tasks?status=queued&mine=true`: масив ТЗ, нові спершу.
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
