import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 6.2: статусу «В черзі» немає. Узяті, але не початі ТЗ стають
// вільними й зберігають виконавців; відкат повертає їм 'queued'.

const MIGRATION = 'TaskStatusWithoutQueued1824000000000';

describe('Міграція статусів ТЗ без «В черзі» (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  const ids: Record<string, string> = {};

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

  async function task(key: string, status: string, assignees: number) {
    const [r] = await ds.query<{ id: string }[]>(
      `INSERT INTO tasks (title, status, points, max_assignees, created_by_id)
       VALUES ($1, $2::tasks_status_enum, 10, 3, $3) RETURNING id`,
      [key, status, ids.u0],
    );
    ids[key] = r.id;
    for (let i = 0; i < assignees; i++) {
      await ds.query(
        `INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)`,
        [r.id, ids[`u${i}`]],
      );
    }
  }

  const row = async (key: string) => {
    const [r] = await ds.query<{ status: string; n: number }[]>(
      `SELECT t.status::text,
              (SELECT count(*)::int FROM task_assignees a WHERE a.task_id = t.id) AS n
       FROM tasks t WHERE t.id = $1`,
      [ids[key]],
    );
    return r;
  };

  it('up: «В черзі» → «Вільне» з виконавцями; down повертає', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    for (const u of ['u0', 'u1', 'u2']) {
      const [r] = await ds.query<{ id: string }[]>(
        `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $1, 'x', 'member') RETURNING id`,
        [`${u}@t`],
      );
      ids[u] = r.id;
    }
    await task('free', 'todo', 0);
    await task('partly', 'queued', 1);
    await task('full', 'queued', 3);
    await task('working', 'in_progress', 2);

    await ds.runMigrations({ transaction: 'all' });

    expect(await row('free')).toEqual({ status: 'todo', n: 0 });
    expect(await row('partly')).toEqual({ status: 'todo', n: 1 });
    expect(await row('full')).toEqual({ status: 'todo', n: 3 });
    expect(await row('working')).toEqual({ status: 'in_progress', n: 2 });
    const values = await ds.query<{ v: string }[]>(
      `SELECT unnest(enum_range(NULL::tasks_status_enum))::text AS v`,
    );
    expect(values.map((r) => r.v)).toEqual([
      'todo',
      'in_progress',
      'review',
      'done',
    ]);

    await undoThrough(MIGRATION);
    expect(await row('free')).toEqual({ status: 'todo', n: 0 });
    expect(await row('partly')).toEqual({ status: 'queued', n: 1 });
    expect(await row('full')).toEqual({ status: 'queued', n: 3 });
    expect(await row('working')).toEqual({ status: 'in_progress', n: 2 });
  });
});
