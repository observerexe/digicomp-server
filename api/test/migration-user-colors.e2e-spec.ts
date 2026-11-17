import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// 6.7е: хто вже є, отримує колір акаунта по черзі — за днем приходу.
const MIGRATION = 'UserColors1833000000000';

describe('Міграція кольорів акаунтів (e2e)', () => {
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

  it('up: кольори по черзі за днем приходу (вісім людей — по колу); down прибирає колонку', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    for (let i = 0; i < 8; i++) {
      // Inserted out of order: the day they joined decides.
      const day = (i * 5) % 8;
      await ds.query(
        `INSERT INTO users (email, name, password_hash, created_at) VALUES ($1, $1, 'x', '2026-01-01'::timestamptz + make_interval(days => $2))`,
        [`u${day}@t`, day],
      );
    }
    await ds.runMigrations({ transaction: 'all' });
    const rows = await ds.query<{ email: string; color: string }[]>(
      `SELECT email, color FROM users ORDER BY created_at`,
    );
    expect(rows.map((r) => r.color)).toEqual([
      'blue',
      'green',
      'orange',
      'purple',
      'teal',
      'red',
      'yellow',
      'blue',
    ]);

    await undoThrough(MIGRATION);
    const cols = await ds.query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'color'`,
    );
    expect(cols).toEqual([]);
  });
});
