import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 0.1б: вільний текст категорій → пункти довідників; відкат повертає текст.

const MIGRATION = 'CategoriesToDictionaries1802000000000';

describe('Міграція категорій (e2e)', () => {
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

  const PLACES = ['Верстати', 'Верстати', ' верстати ', 'Медіа', '  ', 'Друк'];
  const placeIds: string[] = [];
  let docId = '';
  let itemId = '';

  const items = (dict: string) =>
    ds.query<{ key: string; title: string; position: number }[]>(
      `SELECT i.key, i.title, i.position FROM dictionary_items i
       JOIN dictionaries d ON d.id = i.dictionary_id
       WHERE d.key = $1 ORDER BY i.position`,
      [dict],
    );

  it('up: пункти з наявних значень, регістр і пробіли зливаються', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);

    for (const [n, c] of PLACES.entries()) {
      const [p] = await ds.query<{ id: string }[]>(
        `INSERT INTO places (code, title, category) VALUES ($1, 'Місце', $2) RETURNING id`,
        [`P-${n}`, c],
      );
      placeIds.push(p.id);
    }
    const [u] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('u@t', 'u', 'x') RETURNING id`,
    );
    [{ id: docId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO documents (title, category, author_id) VALUES ('Д', 'Паспорти', $1) RETURNING id`,
      [u.id],
    );
    [{ id: itemId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO inventory_items (code, title, category) VALUES ('I-1', 'Фанера', 'Матеріали') RETURNING id`,
    );

    await ds.runMigrations({ transaction: 'all' });

    expect(await items('place_category')).toEqual([
      { key: 'bez_katehorii', title: 'Без категорії', position: 0 },
      { key: 'verstaty', title: 'Верстати', position: 1 },
      { key: 'druk', title: 'Друк', position: 2 },
      { key: 'media', title: 'Медіа', position: 3 },
    ]);
    const rows = await ds.query<{ id: string; category: string }[]>(
      `SELECT id, category FROM places`,
    );
    const byId = new Map(rows.map((r) => [r.id, r.category]));
    expect(placeIds.map((id) => byId.get(id))).toEqual([
      'verstaty',
      'verstaty',
      'verstaty',
      'media',
      'bez_katehorii',
      'druk',
    ]);
    expect(await items('document_category')).toEqual([
      { key: 'pasporty', title: 'Паспорти', position: 0 },
    ]);
    expect(await items('inventory_category')).toEqual([
      { key: 'materialy', title: 'Матеріали', position: 0 },
    ]);
    const [d] = await ds.query<{ category: string }[]>(
      `SELECT category FROM documents WHERE id = $1`,
      [docId],
    );
    expect(d.category).toBe('pasporty');
  });

  it('down: у записах знову назви, довідники категорій прибрано', async () => {
    await ds.query(
      `UPDATE dictionary_items SET title = 'Матеріали й заготовки' WHERE key = 'materialy'`,
    );
    await undoThrough(MIGRATION);
    const rows = await ds.query<{ id: string; category: string }[]>(
      `SELECT id, category FROM places`,
    );
    const byId = new Map(rows.map((r) => [r.id, r.category]));
    expect(placeIds.map((id) => byId.get(id))).toEqual([
      'Верстати',
      'Верстати',
      'Верстати',
      'Медіа',
      'Без категорії',
      'Друк',
    ]);
    const [i] = await ds.query<{ category: string }[]>(
      `SELECT category FROM inventory_items WHERE id = $1`,
      [itemId],
    );
    expect(i.category).toBe('Матеріали й заготовки');
    const [{ n }] = await ds.query<{ n: string }[]>(
      `SELECT count(*) AS n FROM dictionaries`,
    );
    expect(n).toBe('0');
    await ds.runMigrations({ transaction: 'all' });
  });
});
