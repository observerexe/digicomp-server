import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 4.2а: a snapshot refers to the archive document its signed scans
 * are versions of. A new column only; snapshots keep theirs.
 */
export class PaperScans1817000000000 implements MigrationInterface {
  name = 'PaperScans1817000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "paper_snapshots" ADD "archive_doc_id" uuid`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_paper_snapshots_archive_doc" ON "paper_snapshots" ("archive_doc_id") `,
    );
    await q.query(
      `ALTER TABLE "paper_snapshots" ADD CONSTRAINT "FK_f853a8f9dfdbba5109690be67bc" FOREIGN KEY ("archive_doc_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "paper_snapshots" DROP CONSTRAINT "FK_f853a8f9dfdbba5109690be67bc"`,
    );
    await q.query(`DROP INDEX "public"."UQ_paper_snapshots_archive_doc"`);
    await q.query(`ALTER TABLE "paper_snapshots" DROP COLUMN "archive_doc_id"`);
  }
}
