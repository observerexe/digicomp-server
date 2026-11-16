import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 6.6а: the trash. «Видалити» moves equipment, inventory items, files
 * of the Archive and projects to the trash (`deleted_at`, `deleted_by_id`);
 * «Видалити назавжди» erases them or, with history, keeps only the title
 * (`purged_at`). A code is unique among the rows not purged. Nothing moves
 * here: the archive («В архів») stays as it is. Down: the trash goes back to
 * the archive, nothing is lost.
 */
export class Trash1829000000000 implements MigrationInterface {
  name = 'Trash1829000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "places" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "places" ADD "deleted_by_id" uuid`);
    await q.query(
      `ALTER TABLE "places" ADD "purged_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `ALTER TABLE "documents" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "documents" ADD "deleted_by_id" uuid`);
    await q.query(
      `ALTER TABLE "documents" ADD "purged_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `ALTER TABLE "inventory_items" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "inventory_items" ADD "deleted_by_id" uuid`);
    await q.query(
      `ALTER TABLE "inventory_items" ADD "purged_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `ALTER TABLE "projects" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "projects" ADD "deleted_by_id" uuid`);
    await q.query(
      `ALTER TABLE "projects" ADD "purged_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `ALTER TABLE "places" DROP CONSTRAINT "UQ_a6fe963f6700cb1fe4e68002725"`,
    );
    await q.query(
      `ALTER TABLE "inventory_items" DROP CONSTRAINT "UQ_0f18921d7116468ac6932644383"`,
    );
    await q.query(
      `CREATE INDEX "IDX_5e355145554d00c5031c0f46a4" ON "places"  ("deleted_at") `,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_places_code" ON "places"  ("code") WHERE "purged_at" IS NULL`,
    );
    await q.query(
      `CREATE INDEX "IDX_08148bd32b0595201d1beb9265" ON "documents"  ("deleted_at") `,
    );
    await q.query(
      `CREATE INDEX "IDX_57f357021f794530b3b58dcf92" ON "inventory_items"  ("deleted_at") `,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_inventory_items_code" ON "inventory_items"  ("code") WHERE "purged_at" IS NULL`,
    );
    await q.query(
      `CREATE INDEX "IDX_11b52372ea51f9159efe2402d9" ON "projects"  ("deleted_at") `,
    );
    await q.query(
      `ALTER TABLE "places" ADD CONSTRAINT "FK_f8abb5bc887880b4c9eca6f6b04" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_f1c4f762eb3805a26aa07fe7ea9" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_56d00dc614fa435a3d82eabcca7" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_7710757feb82b96695ca985928b" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "projects" DROP CONSTRAINT "FK_7710757feb82b96695ca985928b"`,
    );
    await q.query(
      `ALTER TABLE "inventory_items" DROP CONSTRAINT "FK_56d00dc614fa435a3d82eabcca7"`,
    );
    await q.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_f1c4f762eb3805a26aa07fe7ea9"`,
    );
    await q.query(
      `ALTER TABLE "places" DROP CONSTRAINT "FK_f8abb5bc887880b4c9eca6f6b04"`,
    );
    await q.query(`DROP INDEX "public"."IDX_11b52372ea51f9159efe2402d9"`);
    await q.query(`DROP INDEX "public"."UQ_inventory_items_code"`);
    await q.query(`DROP INDEX "public"."IDX_57f357021f794530b3b58dcf92"`);
    await q.query(`DROP INDEX "public"."IDX_08148bd32b0595201d1beb9265"`);
    await q.query(`DROP INDEX "public"."UQ_places_code"`);
    await q.query(`DROP INDEX "public"."IDX_5e355145554d00c5031c0f46a4"`);
    // Kept for good, a code taken again: the old row's code gets its id.
    await q.query(
      `UPDATE "places" o SET code = left(o.code, 51) || '~' || left(o.id::text, 8) WHERE o.purged_at IS NOT NULL AND EXISTS (SELECT 1 FROM "places" n WHERE n.code = o.code AND n.id <> o.id)`,
    );
    await q.query(
      `UPDATE "inventory_items" o SET code = left(o.code, 51) || '~' || left(o.id::text, 8) WHERE o.purged_at IS NOT NULL AND EXISTS (SELECT 1 FROM "inventory_items" n WHERE n.code = o.code AND n.id <> o.id)`,
    );
    // The trash goes back to the archive (inventory has none: its items show again).
    await q.query(
      `UPDATE "places" SET status = 'archived' WHERE deleted_at IS NOT NULL`,
    );
    await q.query(
      `UPDATE "documents" SET archived_at = COALESCE(archived_at, deleted_at) WHERE deleted_at IS NOT NULL`,
    );
    await q.query(
      `UPDATE "projects" SET archived_at = COALESCE(archived_at, deleted_at) WHERE deleted_at IS NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "UQ_0f18921d7116468ac6932644383" UNIQUE ("code")`,
    );
    await q.query(
      `ALTER TABLE "places" ADD CONSTRAINT "UQ_a6fe963f6700cb1fe4e68002725" UNIQUE ("code")`,
    );
    await q.query(`ALTER TABLE "projects" DROP COLUMN "purged_at"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "deleted_by_id"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "deleted_at"`);
    await q.query(`ALTER TABLE "inventory_items" DROP COLUMN "purged_at"`);
    await q.query(`ALTER TABLE "inventory_items" DROP COLUMN "deleted_by_id"`);
    await q.query(`ALTER TABLE "inventory_items" DROP COLUMN "deleted_at"`);
    await q.query(`ALTER TABLE "documents" DROP COLUMN "purged_at"`);
    await q.query(`ALTER TABLE "documents" DROP COLUMN "deleted_by_id"`);
    await q.query(`ALTER TABLE "documents" DROP COLUMN "deleted_at"`);
    await q.query(`ALTER TABLE "places" DROP COLUMN "purged_at"`);
    await q.query(`ALTER TABLE "places" DROP COLUMN "deleted_by_id"`);
    await q.query(`ALTER TABLE "places" DROP COLUMN "deleted_at"`);
  }
}
