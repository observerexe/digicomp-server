import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 3.1а: a task keeps when it was last sent for review and who
 * accepted it (when — `completed_at`, set on acceptance). Existing tasks
 * take both from the audit log (`task.submitted`, `task.accepted`); an
 * acceptor who is no longer a user stays empty.
 */
export class TaskReview1811000000000 implements MigrationInterface {
  name = 'TaskReview1811000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "tasks" ADD "submitted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "tasks" ADD "accepted_by_id" uuid`);
    await q.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_0542a250cf7a7356dcc15de1279" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Audit times are UTC without a zone (as every `timestamp` column here).
    await q.query(
      `UPDATE "tasks" t
          SET "submitted_at" = a.at
         FROM (SELECT DISTINCT ON ("entity_id") "entity_id", "created_at" AT TIME ZONE 'UTC' AS at
                 FROM "audit_log"
                WHERE "entity" = 'task' AND "action" = 'task.submitted'
                ORDER BY "entity_id", "created_at" DESC) a
        WHERE a."entity_id" = t."id"::text`,
    );
    await q.query(
      `UPDATE "tasks" t
          SET "accepted_by_id" = a."actor_id"
         FROM (SELECT DISTINCT ON ("entity_id") "entity_id", "actor_id"
                 FROM "audit_log"
                WHERE "entity" = 'task' AND "action" = 'task.accepted'
                ORDER BY "entity_id", "created_at" DESC) a
        WHERE a."entity_id" = t."id"::text
          AND t."status" = 'done'
          AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."actor_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_0542a250cf7a7356dcc15de1279"`,
    );
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "accepted_by_id"`);
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "submitted_at"`);
  }
}
