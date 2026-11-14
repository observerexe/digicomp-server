import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 0.3а: наявні ТЗ отримують порожнє extra, відкат прибирає колонку й таблицю.

const MIGRATION = 'RecordFieldDefs1803000000000';

describe('Міграція додаткових полів (e2e)', () => {
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

  const exists = async (table: string, column?: string) => {
    const [r] = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = $1 AND ($2::text IS NULL OR column_name = $2)`,
      [table, column ?? null],
    );
    return r.n > 0;
  };

  it('up: наявні ТЗ з порожнім extra; down: без колонки й таблиці', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    expect(await exists('tasks', 'extra')).toBe(false);
    expect(await exists('record_field_defs')).toBe(false);

    const [u] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('u@t', 'u', 'x') RETURNING id`,
    );
    const [t] = await ds.query<{ id: string }[]>(
      `INSERT INTO tasks (title, points, created_by_id) VALUES ('ТЗ', 5, $1) RETURNING id`,
      [u.id],
    );

    await ds.runMigrations({ transaction: 'all' });
    const [row] = await ds.query<{ title: string; extra: unknown }[]>(
      `SELECT title, extra FROM tasks WHERE id = $1`,
      [t.id],
    );
    expect(row).toEqual({ title: 'ТЗ', extra: {} });
    expect(await exists('record_field_defs')).toBe(true);
  });
});
