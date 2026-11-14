import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 2.1: лише нові таблиці шаблонів; документи, що вже є, не змінюються,
// а відкат прибирає шаблони без сліду.

const MIGRATION = 'PaperTemplates1807000000000';

describe('Міграція шаблонів документів (e2e)', () => {
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

  const tables = async () =>
    (
      await ds.query<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE tablename LIKE 'paper_template%' ORDER BY tablename`,
      )
    ).map((r) => r.tablename);

  it('відкат і повторне застосування не чіпають документи', async () => {
    await resetDb(app);
    const [{ id: userId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('m@t', 'Автор', 'x') RETURNING id`,
    );
    const [{ id: tplId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO paper_templates (title, kind, created_by_id) VALUES ('Шаблон', 'free', $1) RETURNING id`,
      [userId],
    );
    await ds.query(
      `INSERT INTO paper_template_versions (template_id, number, body, fields) VALUES ($1, 1, '{"type":"doc"}', '[]')`,
      [tplId],
    );
    await ds.query(
      `INSERT INTO papers (title, content, author_id) VALUES ('Лист', '{"type":"doc","content":[]}', $1)`,
      [userId],
    );

    await undoThrough(MIGRATION);
    expect(await tables()).toEqual([]);
    const types = await ds.query<unknown[]>(
      `SELECT 1 FROM pg_type WHERE typname LIKE 'paper_templates_%'`,
    );
    expect(types).toHaveLength(0);

    await ds.runMigrations({ transaction: 'all' });
    expect(await tables()).toEqual([
      'paper_template_versions',
      'paper_templates',
    ]);
    const papers = await ds.query<{ title: string }[]>(
      `SELECT title FROM papers`,
    );
    expect(papers).toEqual([{ title: 'Лист' }]);
  });
});
