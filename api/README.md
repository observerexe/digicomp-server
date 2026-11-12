# DigiComp HUB API

Бекенд на NestJS + TypeORM. Як влаштовано: [docs/tech/ARCHITECTURE.md](../docs/tech/ARCHITECTURE.md); запуск, тести й міграції: [docs/tech/DEVELOPMENT.md](../docs/tech/DEVELOPMENT.md).

- Точка входу: `src/main.ts`. Глобальні налаштування (заголовки безпеки, CSRF, фільтр помилок, валідація, CORS)
  у `src/setup-app.ts`; їх використовують і `main.ts`, і e2e-тести.
- Перевірки безпеки для вебу: `src/common/web.ts`, cookie: `src/auth/cookies.ts`.
- Міграції: `src/migrations/`, нова: `../scripts/migration-generate.sh <Name>`.
- Unit-тести лежать поруч із кодом (`*.spec.ts`), e2e у `test/`.
