# DigiComp HUB API

Бекенд на NestJS + TypeORM. Загальний опис, локальний запуск і тести: [README у корені](../README.md).

- Точка входу: `src/main.ts`. Глобальні налаштування (заголовки безпеки, CSRF, фільтр помилок, валідація, CORS)
  у `src/setup-app.ts`; їх використовують і `main.ts`, і e2e-тести.
- Перевірки безпеки для вебу: `src/common/web.ts`, cookie: `src/auth/cookies.ts`.
- Міграції: `src/migrations/`, нова: `../scripts/migration-generate.sh <Name>`.
- Unit-тести лежать поруч із кодом (`*.spec.ts`), e2e у `test/`.
