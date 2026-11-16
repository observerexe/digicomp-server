import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 4.4: a допуск refers to the document that granted its current term
 * («Запис про інструктаж і допуск»). Допуски granted before keep null.
 */
export class AuthorizationPaper1820000000000 implements MigrationInterface {
  name = 'AuthorizationPaper1820000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "place_authorizations" ADD "paper_id" uuid`);
    await q.query(
      `CREATE INDEX "IDX_fc781a5b4e7f2e1d15d2d4bd05" ON "place_authorizations" ("paper_id") `,
    );
    await q.query(
      `ALTER TABLE "place_authorizations" ADD CONSTRAINT "FK_fc781a5b4e7f2e1d15d2d4bd053" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "place_authorizations" DROP CONSTRAINT "FK_fc781a5b4e7f2e1d15d2d4bd053"`,
    );
    await q.query(`DROP INDEX "public"."IDX_fc781a5b4e7f2e1d15d2d4bd05"`);
    await q.query(`ALTER TABLE "place_authorizations" DROP COLUMN "paper_id"`);
  }
}
