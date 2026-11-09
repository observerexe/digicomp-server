import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція ролей: coordinator -> moderator, guest -> заблокований member.
// Відкочуємо її на тестовій базі, кладемо дані у старому вигляді й запускаємо знову.

const MIGRATION = 'RenameCoordinatorRemoveGuest1794000000000';

describe('Міграція ролей (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    // База має лишитися на останній міграції для інших тестів.
    await ds.runMigrations({ transaction: 'all' });
    await app.close();
  });

  const enumValues = async () =>
    (
      await ds.query<{ v: string }[]>(
        `SELECT unnest(enum_range(NULL::"users_role_enum"))::text AS v`,
      )
    ).map((r) => r.v);

  const userRow = async (email: string) =>
    (
      await ds.query<{ role: string; active: boolean; id: string }[]>(
        `SELECT id, role::text AS role, active FROM users WHERE email = $1`,
        [email],
      )
    )[0];

  async function insertUser(email: string, role: string, active = true) {
    const rows = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash, role, active, bio)
       VALUES ($1, $1, 'x', $2, $3, 'моє біо') RETURNING id`,
      [email, role, active],
    );
    return rows[0].id;
  }

  /** Rolls back newer migrations and then the roles migration itself. */
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

  it('міграцію ролей застосовано', async () => {
    const rows = await ds.query<unknown[]>(
      `SELECT 1 FROM migrations WHERE name = $1`,
      [MIGRATION],
    );
    expect(rows).toHaveLength(1);
  });

  it('up: дані не губляться, гості стають заблокованими member', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    expect(await enumValues()).toEqual([
      'admin',
      'coordinator',
      'member',
      'guest',
    ]);

    await insertUser('admin@t', 'admin');
    await insertUser('coord@t', 'coordinator');
    await insertUser('member@t', 'member');
    await insertUser('blocked@t', 'member', false);
    const guestId = await insertUser('guest@t', 'guest');
    await ds.query(
      `INSERT INTO refresh_sessions (user_id, family_id, token_hash, expires_at)
       VALUES ($1, uuid_generate_v4(), repeat('a', 64), now() + interval '1 day')`,
      [guestId],
    );

    await ds.runMigrations({ transaction: 'all' });

    expect(await enumValues()).toEqual(['admin', 'moderator', 'member']);
    expect(await userRow('admin@t')).toMatchObject({
      role: 'admin',
      active: true,
    });
    expect(await userRow('coord@t')).toMatchObject({
      role: 'moderator',
      active: true,
    });
    expect(await userRow('member@t')).toMatchObject({
      role: 'member',
      active: true,
    });
    expect(await userRow('blocked@t')).toMatchObject({
      role: 'member',
      active: false,
    });
    expect(await userRow('guest@t')).toMatchObject({
      role: 'member',
      active: false,
    });

    const sessions = await ds.query<unknown[]>(
      `SELECT 1 FROM refresh_sessions WHERE user_id = $1`,
      [guestId],
    );
    expect(sessions).toHaveLength(0);

    const [log] = await ds.query<{ actor_id: string | null; meta: unknown }[]>(
      `SELECT actor_id, meta FROM audit_log
       WHERE action = 'user.guest_converted' AND entity_id = $1`,
      [guestId],
    );
    expect(log.actor_id).toBeNull();
    expect(log.meta).toMatchObject({ from: 'guest', to: 'member' });

    const [{ count }] = await ds.query<{ count: string }[]>(
      `SELECT count(*) FROM users`,
    );
    expect(Number(count)).toBe(5);

    const [{ def }] = await ds.query<{ def: string }[]>(
      `SELECT column_default AS def FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'role'`,
    );
    expect(def).toContain('member');
  });

  it('down: moderator повертається в coordinator', async () => {
    await undoThrough(MIGRATION);
    expect(await userRow('coord@t')).toMatchObject({ role: 'coordinator' });
    expect(await userRow('guest@t')).toMatchObject({
      role: 'member',
      active: false,
    });
    await ds.runMigrations({ transaction: 'all' });
    expect(await userRow('coord@t')).toMatchObject({ role: 'moderator' });
  });
});
