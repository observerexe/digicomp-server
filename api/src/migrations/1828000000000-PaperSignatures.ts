import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 6.5а: drawn signatures. A snapshot keeps who its lines to sign on
 * await (`signers`; null — frozen before: a scan only, nothing is guessed
 * here); `paper_signatures` — a drawing on a line, only ever added.
 * Snapshots keep everything they have.
 */
export class PaperSignatures1828000000000 implements MigrationInterface {
  name = 'PaperSignatures1828000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "paper_signatures" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "snapshot_id" uuid NOT NULL, "row" integer NOT NULL, "user_id" uuid NOT NULL, "strokes" jsonb NOT NULL, "signed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4adccdb7f624d11a6b6eeac6838" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_paper_signatures_snapshot_row" ON "paper_signatures" ("snapshot_id", "row") `,
    );
    await q.query(`ALTER TABLE "paper_snapshots" ADD "signers" jsonb`);
    await q.query(
      `ALTER TABLE "paper_signatures" ADD CONSTRAINT "FK_f1735562c9005ac744ce1706f7c" FOREIGN KEY ("snapshot_id") REFERENCES "paper_snapshots"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_signatures" ADD CONSTRAINT "FK_bbf0a2fc7b716f908cbea56bd68" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  /**
   * Drawn signatures are gone with their table; a document «Підписано» by
   * them alone stays so (its status is not guessed back).
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "paper_signatures" DROP CONSTRAINT "FK_bbf0a2fc7b716f908cbea56bd68"`,
    );
    await q.query(
      `ALTER TABLE "paper_signatures" DROP CONSTRAINT "FK_f1735562c9005ac744ce1706f7c"`,
    );
    await q.query(`ALTER TABLE "paper_snapshots" DROP COLUMN "signers"`);
    await q.query(`DROP INDEX "public"."UQ_paper_signatures_snapshot_row"`);
    await q.query(`DROP TABLE "paper_signatures"`);
  }
}
