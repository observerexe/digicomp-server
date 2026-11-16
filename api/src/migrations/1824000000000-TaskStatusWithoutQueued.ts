import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 6.2: no «В черзі» status. A task stays free (`todo`) while people
 * take it, until an assignee presses «Почати». Every `queued` task becomes
 * `todo` with its assignees kept; the enum type is recreated without the
 * value. Revert: a `todo` task with assignees becomes `queued` again.
 */
export class TaskStatusWithoutQueued1824000000000 implements MigrationInterface {
  name = 'TaskStatusWithoutQueued1824000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "tasks" SET "status" = 'todo' WHERE "status" = 'queued'`,
    );
    await this.recreate(q, ['todo', 'in_progress', 'review', 'done']);
  }

  public async down(q: QueryRunner): Promise<void> {
    await this.recreate(q, ['todo', 'queued', 'in_progress', 'review', 'done']);
    await q.query(
      `UPDATE "tasks" t SET "status" = 'queued'
       WHERE t."status" = 'todo'
         AND EXISTS (SELECT 1 FROM "task_assignees" a WHERE a."task_id" = t."id")`,
    );
  }

  private async recreate(q: QueryRunner, values: string[]) {
    await q.query(
      `ALTER TYPE "public"."tasks_status_enum" RENAME TO "tasks_status_enum_old"`,
    );
    await q.query(
      `CREATE TYPE "public"."tasks_status_enum" AS ENUM(${values.map((v) => `'${v}'`).join(', ')})`,
    );
    await q.query(`ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT`);
    await q.query(
      `ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "public"."tasks_status_enum" USING "status"::text::"public"."tasks_status_enum"`,
    );
    await q.query(
      `ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'todo'`,
    );
    await q.query(`DROP TYPE "public"."tasks_status_enum_old"`);
  }
}
