import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграції 6.3: довідник «Тип технічного завдання», обов'язкове поле «Тип»,
// усім наявним ТЗ — «Інше»; наявний довідник чи поле зупиняє міграцію без
// змін; відкат прибирає поле, типи ТЗ і довідник. Версії 2 шаблонів ТЗ —
// у task-types.e2e-spec.ts.

const MIGRATION = 'TaskTypes1825000000000';

describe('Міграція типів ТЗ (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let userId: string;

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

  async function task(title: string, extra: Record<string, unknown> = {}) {
    const [r] = await ds.query<{ id: string }[]>(
      `INSERT INTO tasks (title, points, created_by_id, extra) VALUES ($1, 10, $2, $3) RETURNING id`,
      [title, userId, JSON.stringify(extra)],
    );
    return r.id;
  }

  const extraOf = async (id: string) =>
    (
      await ds.query<{ extra: Record<string, unknown> }[]>(
        `SELECT extra FROM tasks WHERE id = $1`,
        [id],
      )
    )[0].extra;

  const count = async (sql: string) =>
    (
      await ds.query<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${sql}`)
    )[0].n;

  beforeEach(async () => {
    await ds.runMigrations({ transaction: 'all' });
    await resetDb(app);
    await undoThrough(MIGRATION);
    const [u] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash, role) VALUES ('u@t', 'u', 'x', 'member') RETURNING id`,
    );
    userId = u.id;
  });

  it('up: шість типів, поле «Тип», старі ТЗ — «Інше» (інші поля лишаються); down прибирає', async () => {
    await ds.query(
      `INSERT INTO dictionaries (key, title) VALUES ('size', 'Розмір')`,
    );
    await ds.query(
      `INSERT INTO record_field_defs (record_type, key, label, type, dictionary, position)
       VALUES ('task', 'size', 'Розмір', 'enum', 'size', 0)`,
    );
    const plain = await task('Без полів');
    const sized = await task('З розміром', { size: 'l' });

    await ds.runMigrations({ transaction: 'all' });

    expect(await extraOf(plain)).toEqual({ type: 'inshe' });
    expect(await extraOf(sized)).toEqual({ size: 'l', type: 'inshe' });
    const items = await ds.query<{ key: string; color: string }[]>(
      `SELECT i.key, i.color FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
        WHERE d.key = 'task_type' ORDER BY i.position`,
    );
    expect(items.map((i) => i.key)).toEqual([
      'prohramuvannia',
      'dyzain',
      'smm',
      'video',
      'k_3d_druk',
      'inshe',
    ]);
    const [def] = await ds.query<Record<string, unknown>[]>(
      `SELECT label, type, required, dictionary, position FROM record_field_defs
        WHERE record_type = 'task' AND key = 'type'`,
    );
    expect(def).toEqual({
      label: 'Тип',
      type: 'enum',
      required: true,
      dictionary: 'task_type',
      position: 1,
    });

    await undoThrough(MIGRATION);
    expect(await extraOf(plain)).toEqual({});
    expect(await extraOf(sized)).toEqual({ size: 'l' });
    expect(await count(`dictionaries WHERE key = 'task_type'`)).toBe(0);
    expect(await count(`record_field_defs WHERE key = 'type'`)).toBe(0);
    expect(await count(`dictionaries WHERE key = 'size'`)).toBe(1);
  });

  it('наявне поле «Тип» у ТЗ зупиняє міграцію, нічого не змінивши', async () => {
    await ds.query(
      `INSERT INTO dictionaries (key, title) VALUES ('kind', 'Вид')`,
    );
    await ds.query(
      `INSERT INTO record_field_defs (record_type, key, label, type, dictionary, position)
       VALUES ('task', 'kind', 'тип', 'enum', 'kind', 0)`,
    );
    const id = await task('ТЗ');

    await expect(ds.runMigrations({ transaction: 'all' })).rejects.toThrow(
      /TaskTypes/,
    );
    expect(await extraOf(id)).toEqual({});
    expect(await count(`dictionaries WHERE key = 'task_type'`)).toBe(0);
    const [last] = await ds.query<{ name: string }[]>(
      `SELECT name FROM migrations ORDER BY id DESC LIMIT 1`,
    );
    expect(last.name).not.toBe(MIGRATION);

    await ds.query(`DELETE FROM record_field_defs WHERE key = 'kind'`);
    await ds.runMigrations({ transaction: 'all' });
    expect(await extraOf(id)).toEqual({ type: 'inshe' });
  });
});
