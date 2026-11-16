import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 6.6а: колонки кошика. Архівне лишається в архіві (у кошик нічого
// не переходить). Відкат: кошик — назад в архів (склад — просто видно),
// записи, видалені назавжди, лишаються; їхній код, зайнятий знову, отримує id.

const MIGRATION = 'Trash1829000000000';

describe('Міграція кошика (e2e)', () => {
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
      await ds.query<{ c: string }[]>(
        `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
         WHERE column_name IN ('deleted_at', 'deleted_by_id', 'purged_at') ORDER BY 1`,
      )
    ).map((r) => r.c);

  it('up: колонки, архівне не в кошику; down: кошик — в архів, нічого не губиться', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    expect(await columns()).toEqual([]);
    const [u] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash, role) VALUES ('u@t', 'u', 'x', 'admin') RETURNING id`,
    );
    await ds.query(
      `INSERT INTO places (code, title, category, status) VALUES ('CNC-1', 'Фрезер', 'v', 'archived'), ('LASER', 'Лазер', 'v', 'active')`,
    );
    await ds.query(
      `INSERT INTO projects (title, archived_at) VALUES ('Старий', now() - interval '1 year')`,
    );

    await ds.runMigrations({ transaction: 'all' });
    expect(await columns()).toEqual(
      ['documents', 'inventory_items', 'places', 'projects'].flatMap((t) => [
        `${t}.deleted_at`,
        `${t}.deleted_by_id`,
        `${t}.purged_at`,
      ]),
    );
    expect(
      await ds.query(
        `SELECT code, status, deleted_at FROM places ORDER BY code`,
      ),
    ).toEqual([
      { code: 'CNC-1', status: 'archived', deleted_at: null },
      { code: 'LASER', status: 'active', deleted_at: null },
    ]);
    expect(
      await ds.query(
        `SELECT title, archived_at IS NOT NULL AS archived, deleted_at FROM projects`,
      ),
    ).toEqual([{ title: 'Старий', archived: true, deleted_at: null }]);

    // Лазер у кошику; давній фрезер видалено назавжди, його код узяв новий.
    await ds.query(
      `UPDATE places SET deleted_at = now(), deleted_by_id = $1 WHERE code = 'LASER'`,
      [u.id],
    );
    await ds.query(
      `UPDATE places SET deleted_at = now(), purged_at = now() WHERE code = 'CNC-1'`,
    );
    await ds.query(
      `INSERT INTO places (code, title, category) VALUES ('CNC-1', 'Новий фрезер', 'v')`,
    );
    await ds.query(
      `INSERT INTO inventory_items (code, title, category, deleted_at) VALUES ('PLY', 'Фанера', 'm', now())`,
    );
    await ds.query(`UPDATE projects SET deleted_at = now()`);

    await undoThrough(MIGRATION);
    expect(await columns()).toEqual([]);
    const places = await ds.query<
      { code: string; title: string; status: string }[]
    >(`SELECT code, title, status FROM places ORDER BY title`);
    expect(places).toEqual([
      { code: 'LASER', title: 'Лазер', status: 'archived' },
      { code: 'CNC-1', title: 'Новий фрезер', status: 'active' },
      {
        code: expect.stringMatching(/^CNC-1~[0-9a-f]{8}$/),
        title: 'Фрезер',
        status: 'archived',
      },
    ]);
    expect(await ds.query(`SELECT code FROM inventory_items`)).toEqual([
      { code: 'PLY' },
    ]);
    expect(
      await ds.query(
        `SELECT archived_at IS NOT NULL AS archived FROM projects`,
      ),
    ).toEqual([{ archived: true }]);
  });
});
