import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 2.2а: документи отримують версію шаблону й значення полів.
// Наявні документи лишаються вільними й нічого не втрачають; відкат прибирає колонки.

const MIGRATION = 'PaperValues1808000000000';

describe('Міграція значень полів документів (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await ds.runMigrations({ transaction: 'all' });
    await app.close();
  });

  async function undoThrough(name: string) {
    for (;;) {
      const [last] = await ds.query<{ name: string }[]>(
        `SELECT name FROM migrations ORDER BY id DESC LIMIT 1`,
      );
      if (!last) throw new Error(`Migration ${name} is not applied`);
      await ds.undoLastMigration({ transaction: 'all' });
      if (last.name === name) return;
    }
  }

  const columns = async () =>
    (
      await ds.query<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'papers' AND column_name IN ('template_version_id', 'values')
          ORDER BY column_name`,
      )
    ).map((r) => r.column_name);

  it('наявні документи стають вільними без значень; відкат прибирає колонки', async () => {
    await resetDb(app);
    const [{ id: userId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('m@t', 'Автор', 'x') RETURNING id`,
    );
    await undoThrough(MIGRATION);
    expect(await columns()).toEqual([]);
    await ds.query(
      `INSERT INTO papers (title, content, author_id) VALUES ('Лист', '{"type":"doc","content":[]}', $1)`,
      [userId],
    );

    await ds.runMigrations({ transaction: 'all' });
    expect(await columns()).toEqual(['template_version_id', 'values']);
    const papers = await ds.query<unknown[]>(
      `SELECT title, content, template_version_id, values FROM papers`,
    );
    expect(papers).toEqual([
      {
        title: 'Лист',
        content: { type: 'doc', content: [] },
        template_version_id: null,
        values: {},
      },
    ]);
  });
});
