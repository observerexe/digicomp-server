import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція етапу 3: вільний текст статусу проєкту → фіксований етап,
// старий текст лишається в аудиті; наявні сеанси не змінюються.

const MIGRATION = 'LabBookingsFaultsProjectStages1796000000000';

describe('Міграція етапу 3 (e2e)', () => {
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

  const CASES: [string, string][] = [
    ['Планується', 'planning'],
    ['Ідея', 'idea'],
    ['В роботі', 'execution'],
    ['виконується', 'execution'],
    ['Работаєм', 'execution'],
    ['На перевірці', 'review'],
    ['Завершено', 'done'],
    ['Виконано', 'done'],
    ['щось своє', 'planning'],
  ];
  const ids: string[] = [];

  it('up: етапи за ключовими словами, старий текст в аудиті', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);

    const [u] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('u@t', 'u', 'x') RETURNING id`,
    );
    const [p] = await ds.query<{ id: string }[]>(
      `INSERT INTO places (code, title, category) VALUES ('P-1', 'Місце', 'К') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO work_sessions (user_id, place_id, started_at, safety_confirmed)
       VALUES ($1, $2, now() - interval '1 hour', true)`,
      [u.id, p.id],
    );
    for (const [status] of CASES) {
      const [row] = await ds.query<{ id: string }[]>(
        `INSERT INTO projects (title, status) VALUES ($1, $1) RETURNING id`,
        [status],
      );
      ids.push(row.id);
    }

    await ds.runMigrations({ transaction: 'all' });

    for (let i = 0; i < CASES.length; i++) {
      const [row] = await ds.query<{ stage: string }[]>(
        `SELECT stage::text FROM projects WHERE id = $1`,
        [ids[i]],
      );
      expect([CASES[i][0], row.stage]).toEqual(CASES[i]);
      const [log] = await ds.query<{ meta: Record<string, string> }[]>(
        `SELECT meta FROM audit_log WHERE action = 'project.stage_migrated' AND entity_id = $1`,
        [ids[i]],
      );
      expect(log.meta).toEqual({ oldStatus: CASES[i][0], stage: CASES[i][1] });
    }
    const [s] = await ds.query<
      { auto_closed: boolean; ended_at: Date | null }[]
    >(`SELECT auto_closed, ended_at FROM work_sessions`);
    expect(s).toEqual({ auto_closed: false, ended_at: null });
  });

  it('down: текстовий статус відновлюється з етапу', async () => {
    await undoThrough(MIGRATION);
    const [row] = await ds.query<{ status: string }[]>(
      `SELECT status FROM projects WHERE id = $1`,
      [ids[2]],
    );
    expect(row.status).toBe('В роботі');
    await ds.runMigrations({ transaction: 'all' });
  });
});
