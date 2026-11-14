import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 0.5: рядок реквізитів зі значеннями з «Прийнятих рішень»;
// підписант — лише якщо рівно один активний «Артур Машталер».

const MIGRATION = 'OrgSettings1805000000000';

type Row = {
  institution: string;
  group_name: string;
  signer_id: string | null;
  signer_position: string;
};

describe('Міграція реквізитів (e2e)', () => {
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

  const user = async (name: string, active = true) =>
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO users (email, name, password_hash, active)
         VALUES ($1, $2, 'x', $3) RETURNING id`,
        [`${Math.random().toString(36).slice(2)}@t`, name, active],
      )
    )[0].id;

  async function migrate(): Promise<Row> {
    await ds.runMigrations({ transaction: 'all' });
    const rows = await ds.query<Row[]>(
      `SELECT institution, group_name, signer_id, signer_position FROM org_settings`,
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  beforeEach(async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
  });

  it('up: значення з рішень, підписант за ім’ям без різниці регістру й пробілів', async () => {
    await user('Артур Машталер', false); // заблокований не рахується
    const id = await user('  артур   МАШТАЛЕР ');
    await user('Інший Учасник');
    expect(await migrate()).toEqual({
      institution: 'КАЛУСЬКИЙ ПОЛІТЕХНІЧНИЙ ФАХОВИЙ КОЛЕДЖ',
      group_name: 'Творча група DigiComp',
      signer_id: id,
      signer_position: 'модератор творчої групи DigiComp',
    });
  });

  it('up: двоє з таким ім’ям або нікого — підписант не вибраний', async () => {
    expect((await migrate()).signer_id).toBeNull();
    await undoThrough(MIGRATION);
    await user('Артур Машталер');
    await user('Артур Машталер');
    expect((await migrate()).signer_id).toBeNull();
  });

  it('другий рядок не додається; видалений підписант очищається', async () => {
    const id = await user('Артур Машталер');
    await migrate();
    await expect(
      ds.query(`INSERT INTO org_settings (id) VALUES (2)`),
    ).rejects.toThrow(/CHK_org_settings_single/);
    await ds.query(`DELETE FROM users WHERE id = $1`, [id]);
    const [row] = await ds.query<Row[]>(`SELECT signer_id FROM org_settings`);
    expect(row.signer_id).toBeNull();
  });

  it('down: таблиця зникає', async () => {
    await migrate();
    await undoThrough(MIGRATION);
    const [{ n }] = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'org_settings'`,
    );
    expect(n).toBe(0);
  });
});
