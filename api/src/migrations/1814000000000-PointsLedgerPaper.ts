import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 3.3б: a manual award refers to the document that made it
 * («Відомість балів»). Entries made before keep null.
 */
export class PointsLedgerPaper1814000000000 implements MigrationInterface {
  name = 'PointsLedgerPaper1814000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "points_ledger" ADD "paper_id" uuid`);
    await q.query(
      `CREATE INDEX "IDX_58df246019460cfc5ecd52e200" ON "points_ledger" ("paper_id") `,
    );
    await q.query(
      `ALTER TABLE "points_ledger" ADD CONSTRAINT "FK_58df246019460cfc5ecd52e200a" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "points_ledger" DROP CONSTRAINT "FK_58df246019460cfc5ecd52e200a"`,
    );
    await q.query(`DROP INDEX "public"."IDX_58df246019460cfc5ecd52e200"`);
    await q.query(`ALTER TABLE "points_ledger" DROP COLUMN "paper_id"`);
  }
}
