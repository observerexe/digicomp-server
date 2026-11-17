import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 6.6в: останні колонки без часового поясу стають `timestamptz`.
// Значення були записані в UTC — так і прочитані; відкат повертає як було.

const MIGRATION = 'TimestampsWithTimeZone1830000000000';

describe('Міграція часових міток (e2e)', () => {
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

  const withoutZone = async () =>
    (
      await ds.query<{ c: string }[]>(
        `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
          WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
          ORDER BY 1`,
      )
    ).map((r) => r.c);

  it('up: усі колонки з поясом, значення — UTC; down повертає як було', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    expect(await withoutZone()).toEqual([
      'audit_log.created_at',
      'points_ledger.created_at',
      'refresh_sessions.created_at',
      'refresh_sessions.expires_at',
      'refresh_sessions.revoked_at',
      'tasks.completed_at',
      'tasks.created_at',
      'tasks.due_date',
      'users.created_at',
    ]);
    const [u] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash, role, created_at)
       VALUES ('u@t', 'u', 'x', 'member', '2026-11-17 00:09:00') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO tasks (title, status, points, created_by_id, created_at, due_date)
       VALUES ('ТЗ', 'todo', 1, $1, '2026-11-17 00:09:00', '2026-12-01 10:00:00')`,
      [u.id],
    );

    await ds.runMigrations({ transaction: 'all' });
    expect(await withoutZone()).toEqual([]);
    const [task] = await ds.query<{ created_at: Date; due_date: Date }[]>(
      `SELECT created_at, due_date FROM tasks`,
    );
    expect(task.created_at.toISOString()).toBe('2026-11-17T00:09:00.000Z');
    expect(task.due_date.toISOString()).toBe('2026-12-01T10:00:00.000Z');
    const [user] = await ds.query<{ created_at: Date }[]>(
      `SELECT created_at FROM users`,
    );
    expect(user.created_at.toISOString()).toBe('2026-11-17T00:09:00.000Z');

    await undoThrough(MIGRATION);
    expect(
      await ds.query(
        `SELECT created_at::text AS c, due_date::text AS d FROM tasks`,
      ),
    ).toEqual([{ c: '2026-11-17 00:09:00', d: '2026-12-01 10:00:00' }]);
  });
});
