import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 4.1: snapshots of frozen documents (the sheet's HTML, its
 * SHA-256, the values it showed). A new table only; documents keep theirs.
 */
export class PaperSnapshots1816000000000 implements MigrationInterface {
  name = 'PaperSnapshots1816000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "paper_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "paper_id" uuid NOT NULL, "n" integer NOT NULL, "html" text NOT NULL, "sha256" character varying(64) NOT NULL, "resolved_values" jsonb NOT NULL, "created_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2593168e98ec8ae1cae5fbf294c" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_paper_snapshots_sha256" ON "paper_snapshots" ("sha256") `,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_paper_snapshots_paper_n" ON "paper_snapshots" ("paper_id", "n") `,
    );
    await q.query(
      `ALTER TABLE "paper_snapshots" ADD CONSTRAINT "FK_7b5a476702a9de7e3f073c305f6" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_snapshots" ADD CONSTRAINT "FK_e7db3962394ea2eaba739598925" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "paper_snapshots" DROP CONSTRAINT "FK_e7db3962394ea2eaba739598925"`,
    );
    await q.query(
      `ALTER TABLE "paper_snapshots" DROP CONSTRAINT "FK_7b5a476702a9de7e3f073c305f6"`,
    );
    await q.query(`DROP INDEX "public"."UQ_paper_snapshots_paper_n"`);
    await q.query(`DROP INDEX "public"."UQ_paper_snapshots_sha256"`);
    await q.query(`DROP TABLE "paper_snapshots"`);
  }
}
