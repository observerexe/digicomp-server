import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 0.4а: links between records. Archive documents tied to equipment
 * (`documents.place_id`) or an inventory item (`documents.inventory_item_id`)
 * become links document → place / inventory_item made by the document's
 * author; the columns go. `inventory_item_id` had no foreign key: ids of
 * items that no longer exist are not carried over (they lead nowhere).
 * Rollback brings the columns back from the links (the oldest one wins).
 */
export class RecordLinks1804000000000 implements MigrationInterface {
  name = 'RecordLinks1804000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "record_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "from_type" character varying(40) NOT NULL, "from_id" uuid NOT NULL, "to_type" character varying(40) NOT NULL, "to_id" uuid NOT NULL, "role" character varying(40) NOT NULL DEFAULT '', "created_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1c7a711887abc1f6daef7960946" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_record_links_from" ON "record_links" ("from_type", "from_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_record_links_to" ON "record_links" ("to_type", "to_id")`,
    );
    // One pair with one role — once, whichever side made the link.
    await q.query(
      `CREATE UNIQUE INDEX "UQ_record_links_pair" ON "record_links" (LEAST("from_type" || ':' || "from_id"::text, "to_type" || ':' || "to_id"::text), GREATEST("from_type" || ':' || "from_id"::text, "to_type" || ':' || "to_id"::text), "role")`,
    );
    await q.query(
      `ALTER TABLE "record_links" ADD CONSTRAINT "FK_1922f70c7fb46e86f2cca46a375" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await q.query(
      `INSERT INTO "record_links" ("from_type", "from_id", "to_type", "to_id", "created_by_id", "created_at")
       SELECT 'document', d."id", 'place', d."place_id", d."author_id", d."created_at"
       FROM "documents" d WHERE d."place_id" IS NOT NULL`,
    );
    await q.query(
      `INSERT INTO "record_links" ("from_type", "from_id", "to_type", "to_id", "created_by_id", "created_at")
       SELECT 'document', d."id", 'inventory_item', d."inventory_item_id", d."author_id", d."created_at"
       FROM "documents" d JOIN "inventory_items" i ON i."id" = d."inventory_item_id"`,
    );

    await q.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_e74e445cfe0098a4ecc7b52455f"`,
    );
    await q.query(`ALTER TABLE "documents" DROP COLUMN "place_id"`);
    await q.query(`ALTER TABLE "documents" DROP COLUMN "inventory_item_id"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "documents" ADD "inventory_item_id" uuid`);
    await q.query(`ALTER TABLE "documents" ADD "place_id" uuid`);
    await q.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_e74e445cfe0098a4ecc7b52455f" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Either direction counts; a document had room for one of each.
    for (const [type, column] of [
      ['place', 'place_id'],
      ['inventory_item', 'inventory_item_id'],
    ]) {
      await q.query(
        `UPDATE "documents" d SET "${column}" = x."other" FROM (
           SELECT DISTINCT ON ("doc") "doc", "other" FROM (
             SELECT "from_id" AS "doc", "to_id" AS "other", "created_at" FROM "record_links"
               WHERE "from_type" = 'document' AND "to_type" = $1
             UNION ALL
             SELECT "to_id", "from_id", "created_at" FROM "record_links"
               WHERE "to_type" = 'document' AND "from_type" = $1
           ) l ORDER BY "doc", "created_at"
         ) x WHERE d."id" = x."doc"`,
        [type],
      );
    }
    await q.query(`DROP TABLE "record_links"`);
  }
}
