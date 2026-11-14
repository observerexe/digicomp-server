import { MigrationInterface, QueryRunner } from 'typeorm';
import { uniqueKey } from '../dictionaries/keys';

/**
 * Editor 0.1б: categories of equipment, archive and stock become items of
 * dictionaries. Every existing value becomes an item; values that differ only
 * in case or spaces become one item, titled by the most used spelling. Rows
 * get the item key instead of the text; down() puts the titles back.
 */
const TARGETS = [
  { table: 'places', key: 'place_category', title: 'Категорія обладнання' },
  { table: 'documents', key: 'document_category', title: 'Категорія архіву' },
  {
    table: 'inventory_items',
    key: 'inventory_category',
    title: 'Категорія складу',
  },
] as const;

const NO_CATEGORY = 'Без категорії';

const clean = (s: string) => s.trim().replace(/\s+/g, ' ') || NO_CATEGORY;
const byTitle = (a: string, b: string) => a.localeCompare(b, 'uk');

type Group = { variants: Map<string, number>; raw: string[] };

export class CategoriesToDictionaries1802000000000 implements MigrationInterface {
  name = 'CategoriesToDictionaries1802000000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const t of TARGETS) {
      const [dict] = (await q.query(
        `INSERT INTO "dictionaries" ("key", "title") VALUES ($1, $2) RETURNING "id"`,
        [t.key, t.title],
      )) as { id: string }[];
      const rows = (await q.query(
        `SELECT "category", count(*) AS n FROM "${t.table}" GROUP BY "category"`,
      )) as { category: string; n: string }[];
      const groups = new Map<string, Group>();
      for (const r of rows) {
        const title = clean(r.category);
        const norm = title.toLocaleLowerCase('uk');
        const g: Group = groups.get(norm) ?? { variants: new Map(), raw: [] };
        g.variants.set(title, (g.variants.get(title) ?? 0) + Number(r.n));
        g.raw.push(r.category);
        groups.set(norm, g);
      }
      // Title of an item: the most used spelling, then the first in the alphabet.
      const items = [...groups.values()]
        .map((g) => ({
          raw: g.raw,
          title: [...g.variants].sort(
            ([a, na], [b, nb]) => nb - na || byTitle(a, b),
          )[0][0],
        }))
        .sort((a, b) => byTitle(a.title, b.title));
      const keys: string[] = [];
      for (const [position, item] of items.entries()) {
        const key = uniqueKey(item.title, keys);
        keys.push(key);
        await q.query(
          `INSERT INTO "dictionary_items" ("dictionary_id", "key", "title", "position") VALUES ($1, $2, $3, $4)`,
          [dict.id, key, item.title, position],
        );
        await q.query(
          `UPDATE "${t.table}" SET "category" = $1 WHERE "category" = ANY($2)`,
          [key, item.raw],
        );
      }
      await q.query(
        `ALTER TABLE "${t.table}" ALTER COLUMN "category" TYPE character varying(40)`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of TARGETS) {
      await q.query(
        `ALTER TABLE "${t.table}" ALTER COLUMN "category" TYPE character varying(100)`,
      );
      await q.query(
        `UPDATE "${t.table}" t SET "category" = i."title"
         FROM "dictionary_items" i JOIN "dictionaries" d ON d."id" = i."dictionary_id"
         WHERE d."key" = $1 AND i."key" = t."category"`,
        [t.key],
      );
      await q.query(
        `DELETE FROM "dictionary_items" WHERE "dictionary_id" IN (SELECT "id" FROM "dictionaries" WHERE "key" = $1)`,
        [t.key],
      );
      await q.query(`DELETE FROM "dictionaries" WHERE "key" = $1`, [t.key]);
    }
  }
}
