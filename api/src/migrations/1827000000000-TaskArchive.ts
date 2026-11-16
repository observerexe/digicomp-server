import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 6.4: archive of tasks. A done task goes to the archive by hand
 * (staff) or by the server 30 days after it was accepted (or returned from
 * the archive). `archived_by_id` is null when the server moved it. Nothing
 * is archived here: the server's hourly run does that, with the audit.
 */
export class TaskArchive1827000000000 implements MigrationInterface {
  name = 'TaskArchive1827000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "tasks" ADD "archived_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "tasks" ADD "archived_by_id" uuid`);
    await q.query(
      `ALTER TABLE "tasks" ADD "unarchived_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `CREATE INDEX "IDX_829ee30b3e0148e777290ba9c6" ON "tasks" ("archived_at") `,
    );
    await q.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_c36561d700d85eb9954286e945d" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_c36561d700d85eb9954286e945d"`,
    );
    await q.query(`DROP INDEX "public"."IDX_829ee30b3e0148e777290ba9c6"`);
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "unarchived_at"`);
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "archived_by_id"`);
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "archived_at"`);
  }
}
