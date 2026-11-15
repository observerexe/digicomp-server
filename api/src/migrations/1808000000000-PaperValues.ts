import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 2.2а: a document may be made from a template version and keeps
 * the values of its fields. Existing documents stay free (no template,
 * no values): nothing is lost.
 */
export class PaperValues1808000000000 implements MigrationInterface {
  name = 'PaperValues1808000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "papers" ADD "template_version_id" uuid`);
    await q.query(
      `ALTER TABLE "papers" ADD "values" jsonb NOT NULL DEFAULT '{}'`,
    );
    await q.query(
      `ALTER TABLE "papers" ADD CONSTRAINT "FK_6572b8d2ee85f8ebc8ff8ac0839" FOREIGN KEY ("template_version_id") REFERENCES "paper_template_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "papers" DROP CONSTRAINT "FK_6572b8d2ee85f8ebc8ff8ac0839"`,
    );
    await q.query(`ALTER TABLE "papers" DROP COLUMN "values"`);
    await q.query(`ALTER TABLE "papers" DROP COLUMN "template_version_id"`);
  }
}
