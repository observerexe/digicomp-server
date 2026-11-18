# Розробка DigiComp HUB

Як запустити проєкт локально, перевірити зміни і що не можна зламати.
Як влаштована система — [ARCHITECTURE.md](ARCHITECTURE.md).

## Що потрібно

- **Node.js 24.9 або новіший** (поле `engines` у `package.json`). На Node 22 юніт-тести API не запускаються:
  Jest вантажить ESM-пакети NestJS 12 лише з Node 24.9. Docker-образ — `node:24-alpine`.
- **Docker з Compose** — для бази (і для запуску всього разом).
- Python 3 — лише для тестів агента сервера.

## Перший запуск

1. Створіть `.env` у корені з прикладу і заповніть:

       cp .env.example .env
       # POSTGRES_USER, POSTGRES_DB — будь-які, напр. digicomp
       # POSTGRES_PASSWORD: openssl rand -hex 24
       # JWT_SECRET:        openssl rand -base64 48
       # TOTP_KEY:          openssl rand -base64 32   (без нього 2FA не вмикається)
       # COMPOSE_PROJECT_NAME=digicomp-local          (щоб не змішати томи з іншими проєктами)

2. Запустіть базу й API (dev-файл відкриває базу на `127.0.0.1:5433` і створює тестову базу `digicomp_test`):

       docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

3. Перевірте: `curl http://127.0.0.1:3000/health` → `{"status":"ok","db":"up",...}`. Міграції застосовуються самі при старті.
4. Створіть першого адміна (працює, лише поки в базі немає жодного користувача). Разом із ним з'являться початкові шаблони редактора,
   зокрема ті, без яких не створити ТЗ:

       curl -X POST http://127.0.0.1:3000/api/auth/setup -H 'Content-Type: application/json' \
         -d '{"email":"admin@example.com","name":"Адмін","password":"не-менше-8-символів"}'

5. Відкрийте `http://127.0.0.1:3000` і увійдіть. Решту учасників створюйте в застосунку: «Панель керування → Учасники → Новий».

Home Assistant і агент для локальної роботи не потрібні: без `HA_TOKEN` не працює лише розумна лабораторія,
без агента — лише розширена панель.

### Робота над кодом

- **Бекенд з автоперезапуском.** API не читає `.env` сам, змінні передаються оточенням. Зупиніть контейнер `api`
  (`docker compose stop api`), щоб звільнити порт 3000, і запустіть з кореня репо:

      set -a; . ./.env; set +a
      export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:5433/$POSTGRES_DB"
      cd api && npm ci && npm run start:dev
- **Фронт з гарячим оновленням:** `cd web && npm ci && npm run dev` → `http://localhost:5173`; запити `/api` проксуються на API `:3000`.
- **Усе разом, як на сервері:** `docker compose up -d --build` — образ збирає і фронт, і API.

### Спільний опис редактора

`shared/editor-schema/` — опис документа редактора, спільний для фронту й бекенду: `index.ts` (вузли, позначки, класи, перевірка вмісту),
`fields.ts` (значення полів шаблону: перевірка, текст для аркуша й друку, звірка документа з тілом шаблону),
`render.ts` (вміст → HTML для друку), `paper.css` (вигляд аркуша). Він не має залежностей і не є пакетом:
обидва пакети компілюють його як свій код, через відносний імпорт.
- **api:** `rootDir` у `tsconfig` — корінь репо, тож збірка лягає в `dist/api/src/` (точка входу `dist/api/src/main`) і `dist/shared/`.
  `paper.css` копіює в `dist/shared/editor-schema/` сам `nest build` (`assets` у `nest-cli.json`); друк читає його під час запуску.
- **web:** `tsconfig.app.json` включає `../shared`, Vite дозволяє її в `server.fs.allow`.
- **Docker:** обидва етапи збірки копіюють `shared/` поруч із пакетом, як у репо.
- Лінтер `shared/` запускає `npm run lint` у `web`. Тести опису — `api/src/paperwork/content.spec.ts` (перевірка вмісту),
  `web/src/editor/schema.test.ts` (TipTap збігається з описом), `web/src/editor/render.test.ts` (друк дає той самий HTML, що й TipTap)
  і `api/src/paperwork/print.spec.ts` (сторінка друку, кольори аркуша = `tokens.json`).
- Поля шаблону на фронті: вузли й блокування тексту — `web/src/editor/fields.ts` (тест `fields.test.ts`), панель «Поля» — `FieldsPanel.tsx`,
  «Форма» телефона — `PaperForm.tsx` (ті самі `FieldGroups`; тести телефона — `vi.stubGlobal('matchMedia', …)` з `matches: false`),
  віджети — реєстр `web/src/editor/fieldTypes/` (новий тип поля — новий файл і рядок у `index.ts`; текст значення — спільний `valueText`).
  Тести полів на бекенді — `api/src/paperwork/fields.spec.ts`, `api/test/paper-fields.e2e-spec.ts`; посилань на записи (`ref:*`, «@», зв'язки документа) —
  `api/test/paper-refs.e2e-spec.ts`; публікації й скасування (номери, документ, що створює ТЗ, видимість через запис) —
  `api/test/paper-publish.e2e-spec.ts`; авто-полів і зміни опублікованого документа — `api/test/paper-change.e2e-spec.ts`;
  міграцій `PaperPublishing` і `TaskReview` — `api/test/migration-paper-publishing.e2e-spec.ts`.
  «Повторювані рядки» — `api/src/paperwork/rows.spec.ts` (значення, правила тіла, «рядок = запис», друк), `api/test/paper-rows.e2e-spec.ts`,
  на фронті — `web/src/editor/repeat.test.tsx` (аркуш, панель, конструктор) і `web/src/editor/builderPanel.test.tsx` (прив'язка стовпців).
  Бали через «Відомість балів» — `api/src/paperwork/points-templates.spec.ts` (шаблон з міграції), `api/test/points-papers.e2e-spec.ts`;
  нарахування, зроблене до документів, e2e пишуть помічником `oldAward` (`api/test/helpers.ts`), відомість — `publishSheet`.
  Початкові шаблони з міграції `StarterTemplates` перевіряє `api/src/paperwork/starter-templates.spec.ts`, шаблони ТЗ (`TaskTemplates`) —
  `api/src/paperwork/task-templates.spec.ts`; ТЗ через документ (шаблони з міграції, `for-record`, номер у ТЗ) — `api/test/task-papers.e2e-spec.ts`;
  документ для старого стягнення й нарахування (`for-record`) і фільтри списку `status`, `about=me` — `api/test/old-record-papers.e2e-spec.ts`.
  Пошук Архіву (файли й документи зі знімком, фільтри, сторінки після злиття) — `api/test/archive.e2e-spec.ts`.
  E2e, яким потрібне ТЗ, а не його створення, роблять його помічником `makeTask` (`api/test/helpers.ts`, сервіс ТЗ, як адаптер документа).
- Бункер: правила гри — чисті функції `api/src/bunker/engine.ts`, кожне правило — тест у `engine.spec.ts` (випадковість задана,
  час — параметр); що бачить гравець — `view.ts` (тест там само); Базовий пак з міграції — `bunker/base-pack.spec.ts`; API, права,
  приховування карт і повна гра — `api/test/bunker.e2e-spec.ts` (Базовий пак після очищення таблиць —
  `Bunker1834000000000.insertBasePack`); сторінки — `web/src/pages/fun/bunker/bunker.test.tsx`.
- Новий вузол чи атрибут додається в опис, у розширення `web/src/editor/extensions.ts`, у `render.ts` і, якщо це клас, — правилом у `paper.css`;
  тести підкажуть, якщо щось пропущено. Змінили кольори палітри в `tokens.json` — оновіть `SHEET_COLORS`.

## Перевірки перед комітом

Мають бути зеленими всі:

    cd api
    npm run lint
    npm test              # юніт-тести
    npm run test:e2e      # e2e: потрібна база з docker-compose.dev.yml

    cd web
    npm test && npm run lint && npm run typecheck && npm run build

    python3 -m unittest discover -s ops/agent      # агент сервера, з кореня репо

- E2e-тести працюють з базою `digicomp_test` на `127.0.0.1:5433` (пароль з кореневого `.env`); іншу задає `TEST_DATABASE_URL`.
  Кожен тест очищає таблиці, локальні дані розробки не зачіпаються. Фонові задачі сервера (автозакриття сеансів, автоархів ТЗ,
  автоочищення кошика й невживаних зображень документів, прибирання кімнат Бункера) у e2e вимкнено змінними `*_DISABLED` з `api/test/setup-env.ts`;
  тести цих задач кличуть їх напряму.
- Home Assistant у e2e підміняється маленьким фейковим сервером (`api/test/smart.e2e-spec.ts`).

## Зміна API

1. Змініть DTO, контролер чи сервіс. Відповіді описуються класами в `responses.dto.ts`, і сервіс повертає саме ці типи —
   так компілятор ловить розбіжність між кодом і документацією.
2. Оновіть схему й типи фронту і закомітьте обидва файли:

       cd api && npm run build && npm run openapi     # → api/openapi.json
       cd web && npm run api:types                    # → web/src/api/schema.d.ts

3. Новий код помилки: текст повідомлення → код у `api/src/common/http-exception.filter.ts`,
   людський текст — у `web/src/errors/messages.ts` (тест перевіряє, що текст є для кожного коду), рядок — у [API.md](API.md).
4. Нове правило доступу — лише в `api/src/auth/policy.ts`, і тест на нього.

Swagger з усіма ендпоінтами: `http://127.0.0.1:3000/api/docs` (увійдіть адміном).

## Міграції бази

Схема змінюється лише міграціями (`api/src/migrations/`); `synchronize` вимкнено, тож зміна сутності сама нічого в базі не змінить.

1. Змініть сутність (`*.entity.ts`).
2. Згенеруйте міграцію: `./scripts/migration-generate.sh НазваЗміни` (збирає образ і порівнює з базою).
3. **Прочитайте SQL.** Перейменування колонки генератор записує як «видалити й створити» — це втрата даних.
   Замініть на `ALTER TABLE ... RENAME COLUMN ...`. Міграція не повинна втрачати наявні дані; перенесення даних пишіть у тій самій міграції.
4. Напишіть `down`, що повертає схему назад.
5. Перевірте, що схема збігається з кодом: `./scripts/schema-check.sh` (або `migration:generate --check` на тестовій базі).

Відкотити останню міграцію: `npx typeorm migration:revert -d dist/api/src/data-source.js` (з `DATABASE_URL`). На сервері надійніше
відновити базу з бекапу і відкотити код — див. [OPERATIONS.md](OPERATIONS.md).

## Правила, які не можна ламати

- Права — лише в `policy.ts` за матрицею з [ARCHITECTURE.md](ARCHITECTURE.md), на кожне правило — тест.
- Кожна дія модератора чи адміна над іншим користувачем пишеться в аудит.
- Помилки API повертають стабільний `errorCode`; фронт показує текст за кодом, а не `message`.
- Не послаблювати безпеку: cookie-вхід з CSRF, CSP, ліміти запитів, аудит, список дозволених пристроїв HA. Розетки й вимикачі (`switch.*`) не додавати.
- Тексти інтерфейсу й документація — українською; код, назви, коміти — англійською.
- Дизайн — за `docs/design/` (кольори з токенів, зони натискання від 44 px, тексти помилок людською мовою).
- Зміна API — оновити [API.md](API.md) і OpenAPI. Зміна поведінки для людей — оновити [README.md](../../README.md).

## Як ведеться робота

- Кожна задача — в окремій гілці від `main`. Після перевірок гілка перемотується в `main` (`git merge --ff-only`).
- Спершу план, код — після підтвердження власника.
- Розгортання — лише з `main`, порядком з [OPERATIONS.md](OPERATIONS.md).
- Claude Code читає `CLAUDE.md` у корені на початку кожної сесії; там коротко зібрано ці правила.

## Відомі питання

- `npm audit` показує вразливості в інструментах розробки (`@nestjs/cli`, `glob`, `tmp`, `workbox-build` → `deepmerge`).
  Вони працюють лише під час збірки й у браузер чи на сервер не потрапляють; `npm audit --omit=dev` має бути чистим в обох пакетах.
  Оновлюємо, коли вийдуть версії з виправленнями, без `npm audit fix --force`.
