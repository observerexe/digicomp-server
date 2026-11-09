import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Адреси аватарів переїжджають під /api (етап 7 переніс API).
const MIGRATION = 'AvatarUrlUnderApi1798000000000';

describe('Міграція адрес аватарів (e2e)', () => {
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

  async function insertUser(email: string, avatar: string | null) {
    await ds.query(
      `INSERT INTO users (email, name, password_hash, avatar_url)
       VALUES ($1, $1, 'x', $2)`,
      [email, avatar],
    );
  }

  const avatars = async () =>
    Object.fromEntries(
      (
        await ds.query<{ email: string; avatar_url: string | null }[]>(
          `SELECT email, avatar_url FROM users ORDER BY email`,
        )
      ).map((r) => [r.email, r.avatar_url]),
    );

  it('up: стара адреса отримує /api, решта без змін; down повертає', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    await insertUser(
      'a@t',
      '/files/avatars/11111111-1111-1111-1111-111111111111',
    );
    await insertUser('b@t', null);
    await insertUser('c@t', 'https://example.com/x.png');

    await ds.runMigrations({ transaction: 'all' });
    expect(await avatars()).toEqual({
      'a@t': '/api/files/avatars/11111111-1111-1111-1111-111111111111',
      'b@t': null,
      'c@t': 'https://example.com/x.png',
    });

    // down: прибирає і /api, і версію (?v=) з адреси.
    await ds.query(
      `UPDATE users SET avatar_url = avatar_url || '?v=5' WHERE email = 'a@t'`,
    );
    await undoThrough(MIGRATION);
    expect((await avatars())['a@t']).toBe(
      '/files/avatars/11111111-1111-1111-1111-111111111111',
    );
    await ds.runMigrations({ transaction: 'all' });
    expect((await avatars())['a@t']).toBe(
      '/api/files/avatars/11111111-1111-1111-1111-111111111111',
    );
  });
});
