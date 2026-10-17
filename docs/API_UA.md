# API DigiComp HUB — довідник для фронтенду

Цей файл описує все, що вміє бекенд станом на кінець кроку 7. Нові зміни додаються сюди ж.
Історичний контракт `/auth`, `/tasks`, `/points` не змінювався: відповіді лише отримали додаткові поля.

## Загальні правила

- Базова адреса: `http://127.0.0.1:3000` (локально). Усі дати в ISO 8601, UTC.
- Авторизація: заголовок `Authorization: Bearer <accessToken>`. Токен доступу живе 1 годину.
- Оновлення сеансу: `POST /auth/refresh` з `{"refreshToken":"..."}`. Кожен refresh-токен одноразовий: у відповіді приходить новий, старий перестає діяти. Токен живе 30 днів. Повторне використання старого токена закриває всі сеанси цього входу.
- Вихід: `POST /auth/logout` з refresh-токеном (цей пристрій) або `POST /auth/logout-all`.
- Ролі: `admin`, `coordinator`, `member`, `guest`. `guest` не має доступу до жодного захищеного ендпоінта. `coordinator` має права `member` плюс керує місцями, допусками, документами, складом і проєктами.
- Права дивіться в `permissions` у відповіді `GET /auth/me`, але остаточно права завжди перевіряє сервер.
- Блокування користувача (`active:false`) діє одразу: його токени перестають працювати.
- Списки повертають `{ "items": [], "total": 0, "page": 1, "limit": 50 }` (`page`, `limit` у query; `limit` до 100–200). Винятки: `/places` повертає масив, `/auth/*` і `/tasks`, `/points` мають свій формат.
- Файли: `multipart/form-data`, поле `file`. Дозволено pdf, png, jpg, webp, docx, xlsx, pptx, txt, md, csv. Документи й матеріали проєктів до 20 МБ, аватари до 2 МБ (png, jpg, webp). Тип перевіряється за вмістом.
- Картинки й файли віддаються лише з `Authorization`, тому `<img src>` і прості посилання не працюють: завантажуйте через `fetch` і показуйте як blob.
- Ідемпотентність: у `POST /places/:id/sessions` і `POST /inventory/items/:id/movements` можна передати `idempotencyKey` (8–64 символи). Повторна відправка з тим самим ключем поверне той самий результат без дубля. Генеруйте новий ключ для кожної дії користувача.
- Ліміти запитів: 100 за хвилину на IP; `login` 5, `setup` 5, `refresh` і `logout` 20 за хвилину.

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
| `NOT_YOUR_SESSION` | 403 | Чужий сеанс може завершити лише admin або coordinator |
| `REASON_REQUIRED` | 400 | Для завершення чужого сеансу потрібна причина |
| `INSUFFICIENT_STOCK` | 409 | Недостатньо залишку на складі |
| `INTEGER_REQUIRED` | 400/409 | Для цієї одиниці кількість має бути цілою |
| `DELTA_ZERO`, `NOTE_REQUIRED` | 400 | Нульовий рух або порожній коментар |
| `STOCK_RECEIVE_FORBIDDEN` | 403 | Надходження на склад оформлюють лише admin і coordinator |
| `FILE_REQUIRED`, `FILE_TYPE_NOT_ALLOWED`, `FILE_CONTENT_MISMATCH` | 400 | Проблеми з завантаженим файлом |
| `PROJECT_EDIT_FORBIDDEN`, `PROJECT_MEMBERS_FORBIDDEN` | 403 | Немає прав редагувати проєкт чи склад учасників |
| `UNKNOWN_PLACE`, `UNKNOWN_MEMBER`, `UNKNOWN_ASSIGNEE` | 400 | Посилання на неіснуючий або неактивний об'єкт |
| `TASK_ALREADY_COMPLETED`, `NOT_YOUR_TASK`, `ADMIN_ONLY_CONFIRM` | 409/403 | Правила завдань |
| `SETUP_ALREADY_COMPLETED` | 409 | Першого адміна вже створено |

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
| POST | `/users` | admin |
| GET | `/users` | admin, coordinator, member |
| PATCH | `/users/me` | admin, coordinator, member |
| PATCH | `/users/me/password` | admin, coordinator, member |
| GET | `/users/:id` | admin, coordinator, member |
| POST | `/users/:id/avatar` | admin, coordinator, member |
| DELETE | `/users/:id/avatar` | admin, coordinator, member |
| PATCH | `/users/:id` | admin |
| POST | `/users/:id/reset-password` | admin |

### Завдання

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/tasks` | admin, coordinator, member |
| POST | `/tasks` | admin |
| PATCH | `/tasks/:id/status` | admin, coordinator, member |

### Бали

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/points/me` | admin, coordinator, member |
| GET | `/points/leaderboard` | admin, coordinator, member |

### Місця (QR-паспорти)

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/places` | admin, coordinator, member |
| GET | `/places/:id` | admin, coordinator, member |
| POST | `/places` | admin, coordinator |
| PATCH | `/places/:id` | admin, coordinator |
| POST | `/places/:id/sessions` | admin, coordinator, member |

### Журнал користування

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/work-sessions` | admin, coordinator, member |
| PATCH | `/work-sessions/:id/end` | admin, coordinator, member |

### Допуски

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/place-authorizations` | admin, coordinator, member |
| POST | `/place-authorizations` | admin, coordinator |
| DELETE | `/place-authorizations/:id` | admin, coordinator |

### Документи

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/documents` | admin, coordinator, member |
| GET | `/documents/:id` | admin, coordinator, member |
| GET | `/documents/:id/versions` | admin, coordinator, member |
| GET | `/documents/:id/download` | admin, coordinator, member |
| POST | `/documents` | admin, coordinator |
| POST | `/documents/:id/files` | admin, coordinator |
| PATCH | `/documents/:id` | admin, coordinator |
| DELETE | `/documents/:id` | admin |

### Файли

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/files/avatars/:userId` | admin, coordinator, member |

### Склад

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/inventory/items` | admin, coordinator, member |
| GET | `/inventory/items/:id` | admin, coordinator, member |
| POST | `/inventory/items` | admin, coordinator |
| PATCH | `/inventory/items/:id` | admin, coordinator |
| POST | `/inventory/items/:id/movements` | admin, coordinator, member |
| GET | `/inventory/movements` | admin, coordinator, member |
| GET | `/inventory/export` | admin, coordinator |

### Проєкти

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/projects` | admin, coordinator, member |
| GET | `/projects/:id` | admin, coordinator, member |
| GET | `/projects/:id/history` | admin, coordinator, member |
| POST | `/projects` | admin, coordinator |
| PATCH | `/projects/:id` | admin, coordinator, member |
| DELETE | `/projects/:id` | admin |
| POST | `/projects/:id/files` | admin, coordinator, member |
| GET | `/projects/:id/files/:fileId/download` | admin, coordinator, member |
| DELETE | `/projects/:id/files/:fileId` | admin, coordinator |

### Аудит

| Метод | Шлях | Хто має доступ |
|---|---|---|
| GET | `/audit` | admin |

## Основні поля запитів

**Користувачі.** `PATCH /users/me`: `name`, `position`, `specialty`, `bio`. `PATCH /users/:id` (admin): ті самі поля плюс `email`, `role`, `active`. `PATCH /users/me/password`: `currentPassword`, `newPassword` (від 8 символів). `POST /users/:id/reset-password` (admin): `newPassword`. Після зміни чи скидання пароля всі refresh-сеанси закриваються. `POST /users/:id/avatar`: multipart, поле `file`. Після цього `avatarUrl` дорівнює `/files/avatars/<id>`.
`GET /users`: фільтри `search`, `role`, `active`, `page`, `limit`. Admin і coordinator бачать `email`, `bio`, `active`, member бачить лише `id`, `name`, `role`, `position`, `specialty`, `avatarUrl`.

**Місця.** `POST /places`: `code` (латиниця, цифри, `_`, `-`, 3–60), `title`, `category`, `location`, `description`, `needsAuthorization` (за замовчуванням true), `exclusive` (за замовчуванням true). `status`: `active`, `maintenance`, `archived`. У шляху `:id` можна передавати uuid або код (наприклад `SOLDER-01`): так працюють QR-посилання. У відповіді: `inUse`, `activeSessions`, `myAuthorization`.

**Сеанси.** `POST /places/:id/sessions`: `safetyConfirmed: true` (обов'язково), `note`, `idempotencyKey`. Час початку ставить сервер, користувач береться з токена. `PATCH /work-sessions/:id/end`: `note`, `equipmentState`, `reason` (обов'язкова, якщо завершує не власник). `GET /work-sessions`: `placeId`, `userId`, `active`, `from`, `to`; member бачить лише свої. Admin і coordinator можуть починати сеанс без допуску.

**Допуски.** `POST /place-authorizations`: `userId`, `placeId`, `expiresAt` (необов'язково), `note`. Повторна видача оновлює термін.

**Документи.** `POST /documents` (multipart): `title`, `category`, `description`, `accessScope` (`members` або `supervisors`), `placeId`, `inventoryItemId`, `file`. `POST /documents/:id/files`: нова версія (`file`, `changeNote`), попередні версії не змінюються. `GET /documents/:id/download?version=N`. `DELETE /documents/:id` лише архівує. У списку `GET /documents`: `search`, `category`, `placeId`, `inventoryItemId`.

**Склад.** `POST /inventory/items`: `code`, `title`, `category`, `unit` (за замовчуванням `шт`), `quantity` (початковий залишок), `minQuantity`, `location`, `notes`. Кількість напряму не змінюється: лише `POST /inventory/items/:id/movements` з `delta` (від'ємне чи додатне, до 3 знаків), `note` (обов'язково), `projectId`, `idempotencyKey`. Member може лише видавати (`delta` менше нуля). Для одиниць `шт`, `pcs`, `уп` кількість лише ціла. У позиції є `lowStock` і `documentsCount`, у `GET /inventory/items/:id` ще й список прив'язаних документів. `GET /inventory/items?lowStock=true` показує позиції з низьким залишком.

**Проєкти.** `POST /projects` (admin, coordinator): `title`, `description`, `status`, `progress` (0–100), `accomplishments`, `sources` (масив рядків), `memberIds`. `PATCH /projects/:id`: ті самі поля. Admin і coordinator редагують усе, member лише проєкти, де він учасник, і не може змінювати `memberIds`. У `GET /projects/:id` є `canEdit`. `GET /projects/:id/history`: журнал змін.

**Завдання й бали (без змін).** `POST /tasks` (admin): `title`, `description`, `points`, `dueDate`, `assigneeIds`. `PATCH /tasks/:id/status`: `status` (`todo`, `in_progress`, `review`, `done`). Подробиці дивіться в `BACKEND_INTEGRATION.md`.

## Що ще не реалізовано

Home Assistant, сповіщення, імпорт команди з CSV, перенесення даних зі старого SQLite, режим cookie для PWA, прив'язка завдань до проєктів, автоматичний скан файлів на віруси.
