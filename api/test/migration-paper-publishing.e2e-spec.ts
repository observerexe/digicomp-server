import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграції 3.1а: документи отримують номер, запис і причину скасування
// (наявні нічого не втрачають); ТЗ — час здачі й того, хто прийняв, з аудиту.
// Відкат прибирає колонки; повторне застосування дає те саме.

const FIRST = 'PaperPublishing1810000000000';

describe('Міграції публікації документів і приймання ТЗ (e2e)', () => {
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

  const columns = async (table: string, names: string[]) =>
    (
      await ds.query<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND column_name = ANY($2)
          ORDER BY column_name`,
        [table, names],
      )
    ).map((r) => r.column_name);
  const PAPER = [
    'cancel_reason',
    'number',
    'published_at',
    'target_id',
    'target_type',
  ];
  const TASK = ['accepted_by_id', 'submitted_at'];

  it('ТЗ беруть здачу й того, хто прийняв, з аудиту; документи не змінюються', async () => {
    await resetDb(app);
    const user = async (email: string) =>
      (
        await ds.query<{ id: string }[]>(
          `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Х', 'x') RETURNING id`,
          [email],
        )
      )[0].id;
    const mod = await user('mod@t');
    const gone = await user('gone@t');
    await undoThrough(FIRST);
    expect(await columns('papers', PAPER)).toEqual([]);
    expect(await columns('tasks', TASK)).toEqual([]);
    expect(
      await ds.query(
        `SELECT 1 FROM pg_tables WHERE tablename = 'paper_counters'`,
      ),
    ).toHaveLength(0);

    const task = async (title: string, status: string) =>
      (
        await ds.query<{ id: string }[]>(
          `INSERT INTO tasks (title, points, created_by_id, status) VALUES ($1, 5, $2, $3) RETURNING id`,
          [title, mod, status],
        )
      )[0].id;
    const done = await task('Прийняте', 'done');
    const back = await task('Повернуте', 'in_progress');
    const lost = await task('Прийняв видалений', 'done');
    const fresh = await task('Нове', 'todo');
    const log = (action: string, id: string, actor: string, at: string) =>
      ds.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, created_at)
         VALUES ($1, $2, 'task', $3, $4)`,
        [actor, action, id, at],
      );
    await log('task.submitted', done, mod, '2026-03-01 09:00:00');
    await log('task.submitted', done, mod, '2026-03-02 09:00:00');
    await log('task.accepted', done, mod, '2026-03-03 09:00:00');
    await log('task.submitted', back, mod, '2026-03-04 09:00:00');
    await log('task.accepted', lost, gone, '2026-03-05 09:00:00');
    await ds.query(`DELETE FROM users WHERE id = $1`, [gone]);
    await ds.query(
      `INSERT INTO papers (title, content, author_id) VALUES ('Лист', '{"type":"doc","content":[]}', $1)`,
      [mod],
    );

    await ds.runMigrations({ transaction: 'all' });
    expect(await columns('papers', PAPER)).toEqual(PAPER);
    expect(await columns('tasks', TASK)).toEqual(TASK);
    const rows = await ds.query<
      { id: string; submitted: string | null; accepted_by_id: string | null }[]
    >(
      `SELECT id, to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS submitted, accepted_by_id FROM tasks`,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(done)).toMatchObject({
      submitted: '2026-03-02 09:00',
      accepted_by_id: mod,
    });
    expect(byId.get(back)).toMatchObject({
      submitted: '2026-03-04 09:00',
      accepted_by_id: null,
    });
    expect(byId.get(lost)).toMatchObject({
      submitted: null,
      accepted_by_id: null,
    });
    expect(byId.get(fresh)).toMatchObject({
      submitted: null,
      accepted_by_id: null,
    });
    expect(
      await ds.query(
        `SELECT title, number, target_type, target_id, published_at, cancel_reason FROM papers`,
      ),
    ).toEqual([
      {
        title: 'Лист',
        number: null,
        target_type: null,
        target_id: null,
        published_at: null,
        cancel_reason: null,
      },
    ]);

    await undoThrough(FIRST);
    expect(await columns('papers', PAPER)).toEqual([]);
    expect(await columns('tasks', TASK)).toEqual([]);
    expect(await ds.query(`SELECT title FROM tasks`)).toHaveLength(4);
    await ds.runMigrations({ transaction: 'all' });
    expect(await columns('tasks', TASK)).toEqual(TASK);
  });
});
