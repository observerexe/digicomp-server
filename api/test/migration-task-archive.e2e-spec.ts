import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 6.4: колонки архіву ТЗ. Наявні ТЗ лишаються як були (не в архіві);
// відкат прибирає колонки, ТЗ не губляться.

const MIGRATION = 'TaskArchive1827000000000';

describe('Міграція архіву ТЗ (e2e)', () => {
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
         WHERE table_name = 'tasks' AND column_name LIKE '%archived%' ORDER BY 1`,
      )
    ).map((r) => r.column_name);

  it('up: колонки є, наявні ТЗ не в архіві; down прибирає колонки, ТЗ лишаються', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    expect(await columns()).toEqual([]);
    const [u] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash, role) VALUES ('u@t', 'u', 'x', 'member') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO tasks (title, status, points, created_by_id, completed_at)
       VALUES ('Давнє', 'done', 10, $1, now() - interval '1 year')`,
      [u.id],
    );

    await ds.runMigrations({ transaction: 'all' });
    expect(await columns()).toEqual([
      'archived_at',
      'archived_by_id',
      'unarchived_at',
    ]);
    expect(
      await ds.query(
        `SELECT title, archived_at, archived_by_id, unarchived_at FROM tasks`,
      ),
    ).toEqual([
      {
        title: 'Давнє',
        archived_at: null,
        archived_by_id: null,
        unarchived_at: null,
      },
    ]);

    await ds.query(
      `UPDATE tasks SET archived_at = now(), archived_by_id = $1`,
      [u.id],
    );
    await undoThrough(MIGRATION);
    expect(await columns()).toEqual([]);
    expect(await ds.query(`SELECT title FROM tasks`)).toEqual([
      { title: 'Давнє' },
    ]);
  });
});
