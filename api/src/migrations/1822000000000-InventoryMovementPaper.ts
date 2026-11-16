import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 5.4: a movement of stock refers to the «Акт списання» that wrote
 * it off (or returned it when the act was cancelled). Movements made before
 * keep null.
 */
export class InventoryMovementPaper1822000000000 implements MigrationInterface {
  name = 'InventoryMovementPaper1822000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "inventory_movements" ADD "paper_id" uuid`);
    await q.query(
      `CREATE INDEX "IDX_9f7d29bcc7575edc72857d3ac0" ON "inventory_movements" ("paper_id") `,
    );
    await q.query(
      `ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_9f7d29bcc7575edc72857d3ac00" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_9f7d29bcc7575edc72857d3ac00"`,
    );
    await q.query(`DROP INDEX "public"."IDX_9f7d29bcc7575edc72857d3ac0"`);
    await q.query(`ALTER TABLE "inventory_movements" DROP COLUMN "paper_id"`);
  }
}
