import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 3.1а: documents are published (a number, the record they created)
 * and cancelled with a reason; numbers are counted by prefix and year.
 * New columns and a table only: existing documents stay as they are.
 */
export class PaperPublishing1810000000000 implements MigrationInterface {
  name = 'PaperPublishing1810000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "paper_counters" ("prefix" character varying(10) NOT NULL, "year" integer NOT NULL, "last" integer NOT NULL, CONSTRAINT "PK_7644ac1717a9264c136e707e34c" PRIMARY KEY ("prefix", "year"))`,
    );
    await q.query(`ALTER TABLE "papers" ADD "number" character varying(30)`);
    await q.query(
      `ALTER TABLE "papers" ADD "target_type" character varying(40)`,
    );
    await q.query(`ALTER TABLE "papers" ADD "target_id" uuid`);
    await q.query(
      `ALTER TABLE "papers" ADD "published_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "papers" ADD "cancel_reason" text`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_papers_number" ON "papers" ("number") `,
    );
    await q.query(
      `CREATE INDEX "IDX_papers_target" ON "papers" ("target_type", "target_id") `,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."IDX_papers_target"`);
    await q.query(`DROP INDEX "public"."UQ_papers_number"`);
    await q.query(`ALTER TABLE "papers" DROP COLUMN "cancel_reason"`);
    await q.query(`ALTER TABLE "papers" DROP COLUMN "published_at"`);
    await q.query(`ALTER TABLE "papers" DROP COLUMN "target_id"`);
    await q.query(`ALTER TABLE "papers" DROP COLUMN "target_type"`);
    await q.query(`ALTER TABLE "papers" DROP COLUMN "number"`);
    await q.query(`DROP TABLE "paper_counters"`);
  }
}
