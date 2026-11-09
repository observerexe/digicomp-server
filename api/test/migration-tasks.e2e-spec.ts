import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція етапу 2: наявні ТЗ, виконавці й бали переносяться без втрат.
// Відкочуємо її, кладемо дані у старому вигляді й запускаємо знову.

const MIGRATION = 'TasksPointsDiscipline1795000000000';

describe('Міграція ТЗ і балів (e2e)', () => {
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

  const ids: Record<string, string> = {};

  async function user(key: string) {
    const [r] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $1, 'x', 'member') RETURNING id`,
      [`${key}@t`],
    );
    ids[key] = r.id;
  }

  async function task(key: string, status: string, assignees: string[]) {
    const [r] = await ds.query<{ id: string }[]>(
      `INSERT INTO tasks (title, status, points, created_by_id, completed_at)
       VALUES ($1, $2::tasks_status_enum, 10, $3, CASE WHEN $2::text = 'done' THEN now() END) RETURNING id`,
      [key, status, ids.u1],
    );
    ids[key] = r.id;
    for (const a of assignees) {
      await ds.query(
        `INSERT INTO task_assignees ("tasksId", "usersId") VALUES ($1, $2)`,
        [r.id, ids[a]],
      );
    }
  }

  const taskRow = async (key: string) =>
    (
      await ds.query<{ status: string; max_assignees: number }[]>(
        `SELECT status::text, max_assignees FROM tasks WHERE id = $1`,
        [ids[key]],
      )
    )[0];

  const balances = async () =>
    Object.fromEntries(
      (
        await ds.query<{ user_id: string; total: number }[]>(
          `SELECT user_id, SUM(amount)::int AS total FROM points_ledger GROUP BY user_id`,
        )
      ).map((r) => [r.user_id, r.total]),
    );

  it('up: ТЗ, виконавці й бали зберігаються', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);

    for (const u of ['u1', 'u2', 'u3']) await user(u);
    await task('free', 'todo', []);
    await task('takenNotStarted', 'todo', ['u1', 'u2']);
    await task('working', 'in_progress', ['u3']);
    await task('review', 'review', ['u1']);
    await task('done', 'done', ['u1', 'u2']);
    // Старий підхід: кожен виконавець отримав повну суму.
    for (const u of ['u1', 'u2']) {
      await ds.query(
        `INSERT INTO points_ledger (user_id, amount, reason, task_id) VALUES ($1, 10, 'task_completed', $2)`,
        [ids[u], ids.done],
      );
    }
    await ds.query(
      `INSERT INTO points_ledger (user_id, amount, reason) VALUES ($1, 3, 'bonus')`,
      [ids.u3],
    );
    const before = await balances();

    await ds.runMigrations({ transaction: 'all' });

    expect(await taskRow('free')).toEqual({ status: 'todo', max_assignees: 1 });
    expect(await taskRow('takenNotStarted')).toEqual({
      status: 'queued',
      max_assignees: 2,
    });
    expect(await taskRow('working')).toEqual({
      status: 'in_progress',
      max_assignees: 1,
    });
    expect((await taskRow('review')).status).toBe('review');
    expect(await taskRow('done')).toEqual({ status: 'done', max_assignees: 2 });

    const assignees = await ds.query<{ task_id: string; user_id: string }[]>(
      `SELECT task_id, user_id FROM task_assignees WHERE taken_at IS NOT NULL`,
    );
    expect(assignees).toHaveLength(6);
    expect(assignees).toContainEqual({
      task_id: ids.working,
      user_id: ids.u3,
    });

    // Бали не перераховуються, лише отримують вид запису.
    expect(await balances()).toEqual(before);
    const kinds = await ds.query<{ kind: string; n: number }[]>(
      `SELECT kind::text, count(*)::int AS n FROM points_ledger GROUP BY kind ORDER BY kind`,
    );
    expect(kinds).toEqual([
      { kind: 'manual', n: 1 },
      { kind: 'task', n: 2 },
    ]);

    // Перенесені ТЗ працюють через новий API (видно в списку зі статусом).
    const [{ n }] = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM tasks`,
    );
    expect(n).toBe(5);
  });

  it('down: схема повертається, дані лишаються', async () => {
    await undoThrough(MIGRATION);
    const [row] = await ds.query<{ status: string }[]>(
      `SELECT status::text FROM tasks WHERE id = $1`,
      [ids.takenNotStarted],
    );
    expect(row.status).toBe('todo');
    const [{ n }] = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM task_assignees WHERE "tasksId" = $1`,
      [ids.takenNotStarted],
    );
    expect(n).toBe(2);
    await ds.runMigrations({ transaction: 'all' });
    expect((await taskRow('takenNotStarted')).status).toBe('queued');
  });
});
