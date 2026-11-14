import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDb } from './helpers';

// Міграція 0.4а: documents.place_id / inventory_item_id → record_links; відкат повертає колонки.

const MIGRATION = 'RecordLinks1804000000000';
const GONE_ITEM = '00000000-0000-4000-8000-000000000001';

type LinkRow = {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  role: string;
  created_by_id: string;
};

describe("Міграція зв'язків (e2e)", () => {
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
      await ds.query<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'documents' AND column_name IN ('place_id', 'inventory_item_id')`,
      )
    )
      .map((c) => c.column_name)
      .sort();

  let userId = '';
  let placeId = '';
  let itemId = '';
  const docs: Record<string, string> = {};

  it('up: прив’язки документів стають зв’язками, колонки зникають', async () => {
    await resetDb(app);
    await undoThrough(MIGRATION);
    expect(await columns()).toEqual(['inventory_item_id', 'place_id']);

    [{ id: userId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (email, name, password_hash) VALUES ('u@t', 'u', 'x') RETURNING id`,
    );
    [{ id: placeId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO places (code, title, category) VALUES ('CNC-1', 'Фрезер', 'verstaty') RETURNING id`,
    );
    [{ id: itemId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO inventory_items (code, title, category) VALUES ('PLY-1', 'Фанера', 'materialy') RETURNING id`,
    );
    for (const [name, place, item] of [
      ['both', placeId, itemId],
      ['place', placeId, null],
      ['gone', null, GONE_ITEM],
      ['none', null, null],
    ] as const) {
      [{ id: docs[name] }] = await ds.query<{ id: string }[]>(
        `INSERT INTO documents (title, category, author_id, place_id, inventory_item_id)
         VALUES ($1, 'pasporty', $2, $3, $4) RETURNING id`,
        [name, userId, place, item],
      );
    }

    await ds.runMigrations({ transaction: 'all' });

    expect(await columns()).toEqual([]);
    const rows = await ds.query<LinkRow[]>(
      `SELECT from_type, from_id, to_type, to_id, role, created_by_id
       FROM record_links ORDER BY from_id, to_type`,
    );
    const link = (doc: string, toType: string, toId: string) => ({
      from_type: 'document',
      from_id: docs[doc],
      to_type: toType,
      to_id: toId,
      role: '',
      created_by_id: userId,
    });
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        link('both', 'inventory_item', itemId),
        link('both', 'place', placeId),
        link('place', 'place', placeId),
      ]),
    );
  });

  it('та сама пара в зворотному напрямку не додається', async () => {
    await expect(
      ds.query(
        `INSERT INTO record_links (from_type, from_id, to_type, to_id, created_by_id)
         VALUES ('place', $1, 'document', $2, $3)`,
        [placeId, docs.place, userId],
      ),
    ).rejects.toThrow(/UQ_record_links_pair/);
  });

  it('down: колонки повертаються зі зв’язків у будь-якому напрямку', async () => {
    // Зв'язок, створений з боку обладнання, теж повертається в колонку.
    await ds.query(`DELETE FROM record_links WHERE from_id = $1`, [docs.place]);
    await ds.query(
      `INSERT INTO record_links (from_type, from_id, to_type, to_id, created_by_id)
       VALUES ('place', $1, 'document', $2, $3)`,
      [placeId, docs.place, userId],
    );
    await undoThrough(MIGRATION);
    const rows = await ds.query<
      {
        title: string;
        place_id: string | null;
        inventory_item_id: string | null;
      }[]
    >(`SELECT title, place_id, inventory_item_id FROM documents`);
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    expect(byTitle.get('both')).toMatchObject({
      place_id: placeId,
      inventory_item_id: itemId,
    });
    expect(byTitle.get('place')).toMatchObject({
      place_id: placeId,
      inventory_item_id: null,
    });
    expect(byTitle.get('gone')).toMatchObject({
      place_id: null,
      inventory_item_id: null,
    });
    expect(await ds.query(`SELECT to_regclass('record_links') AS t`)).toEqual([
      { t: null },
    ]);
    await ds.runMigrations({ transaction: 'all' });
  });
});
