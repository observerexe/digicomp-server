import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 4.3б: «Авто-таблиця» rows are kept in the document once it is
 * frozen (until then they are live). A new column only; null — never frozen.
 */
export class PaperTables1818000000000 implements MigrationInterface {
  name = 'PaperTables1818000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "papers" ADD "tables" jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "papers" DROP COLUMN "tables"`);
  }
}
