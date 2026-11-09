import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 2: task board, points split, discipline.
 *
 * Keeps all data:
 *  - task_assignees: columns are renamed (not recreated), taken_at is added;
 *  - tasks: status enum gets 'queued' (type recreated so the value can be used
 *    in the same transaction); free tasks that already have assignees become
 *    queued; max_assignees = max(1, current assignees);
 *  - points_ledger: existing rows are kept as is, kind is filled from
 *    task_id / reason. Points of completed tasks are not recalculated.
 */
export class TasksPointsDiscipline1795000000000 implements MigrationInterface {
  name = 'TasksPointsDiscipline1795000000000';

  public async up(q: QueryRunner): Promise<void> {
    // --- task_assignees: explicit entity with task_id, user_id, taken_at ---
    await q.query(
      `ALTER TABLE "task_assignees" DROP CONSTRAINT "FK_836169568c5c001ee34e7aa78f7"`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" DROP CONSTRAINT "FK_e54b42e47461564bc4b18b8f933"`,
    );
    await q.query(`DROP INDEX "public"."IDX_836169568c5c001ee34e7aa78f"`);
    await q.query(`DROP INDEX "public"."IDX_e54b42e47461564bc4b18b8f93"`);
    await q.query(
      `ALTER TABLE "task_assignees" DROP CONSTRAINT "PK_71259eff171eb323f416cd3b74d"`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" RENAME COLUMN "tasksId" TO "task_id"`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" RENAME COLUMN "usersId" TO "user_id"`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" ADD "taken_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "PK_7ae8012667c1cc4ca8266002afc" PRIMARY KEY ("task_id", "user_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_bb8051e376a2b083e074678cb6" ON "task_assignees" ("user_id") `,
    );
    await q.query(
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_0141288f2306f20da9a60ec8d69" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_bb8051e376a2b083e074678cb60" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- tasks: limit of assignees, updated_at, 'queued' status ---
    await q.query(
      `ALTER TABLE "tasks" ADD "max_assignees" integer NOT NULL DEFAULT '1'`,
    );
    await q.query(
      `ALTER TABLE "tasks" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await q.query(
      `UPDATE "tasks" t SET
         "max_assignees" = GREATEST(1, (SELECT count(*) FROM "task_assignees" a WHERE a."task_id" = t."id")),
         "updated_at" = COALESCE(t."completed_at", t."created_at")::timestamptz`,
    );
    await q.query(
      `ALTER TYPE "public"."tasks_status_enum" RENAME TO "tasks_status_enum_old"`,
    );
    await q.query(
      `CREATE TYPE "public"."tasks_status_enum" AS ENUM('todo', 'queued', 'in_progress', 'review', 'done')`,
    );
    await q.query(`ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT`);
    await q.query(
      `ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "public"."tasks_status_enum" USING "status"::text::"public"."tasks_status_enum"`,
    );
    await q.query(
      `ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'todo'`,
    );
    await q.query(`DROP TYPE "public"."tasks_status_enum_old"`);
    await q.query(
      `UPDATE "tasks" t SET "status" = 'queued'
       WHERE t."status" = 'todo'
         AND EXISTS (SELECT 1 FROM "task_assignees" a WHERE a."task_id" = t."id")`,
    );

    // --- points_ledger: kind, author, reversals ---
    await q.query(
      `CREATE TYPE "public"."points_ledger_kind_enum" AS ENUM('task', 'manual', 'fine', 'reversal')`,
    );
    await q.query(
      `ALTER TABLE "points_ledger" ADD "kind" "public"."points_ledger_kind_enum"`,
    );
    await q.query(
      `UPDATE "points_ledger" SET "kind" =
         CASE WHEN "task_id" IS NOT NULL OR "reason" = 'task_completed'
              THEN 'task'::"public"."points_ledger_kind_enum"
              ELSE 'manual'::"public"."points_ledger_kind_enum" END`,
    );
    await q.query(
      `ALTER TABLE "points_ledger" ALTER COLUMN "kind" SET NOT NULL`,
    );
    await q.query(`ALTER TABLE "points_ledger" ADD "created_by_id" uuid`);
    await q.query(`ALTER TABLE "points_ledger" ADD "reverses_id" uuid`);
    await q.query(
      `ALTER TABLE "points_ledger" ADD CONSTRAINT "UQ_26a6c3b48604df86b106de40a66" UNIQUE ("reverses_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_da695f16d02317721eb76711fe" ON "points_ledger" ("user_id") `,
    );

    // --- new tables ---
    await q.query(
      `CREATE TYPE "public"."discipline_records_type_enum" AS ENUM('warning', 'fine', 'reprimand')`,
    );
    await q.query(
      `CREATE TABLE "discipline_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" "public"."discipline_records_type_enum" NOT NULL, "reason" text NOT NULL, "amount" integer, "issued_by_id" uuid NOT NULL, "ledger_entry_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_by_id" uuid, "revoke_reason" text, CONSTRAINT "CHK_c1ad73d165fb08d1ee1d489020" CHECK (("type" = 'fine' AND "amount" IS NOT NULL AND "amount" > 0) OR ("type" <> 'fine' AND "amount" IS NULL)), CONSTRAINT "PK_a3d8b4f4d4e7ba4eab6a9802107" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_25669900611dddcc98b1a61509" ON "discipline_records" ("user_id") `,
    );
    await q.query(
      `CREATE TYPE "public"."task_comments_kind_enum" AS ENUM('comment', 'return')`,
    );
    await q.query(
      `CREATE TABLE "task_comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "task_id" uuid NOT NULL, "author_id" uuid NOT NULL, "kind" "public"."task_comments_kind_enum" NOT NULL DEFAULT 'comment', "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_83b99b0b03db29d4cafcb579b77" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_ba9e465cfc707006e60aae5994" ON "task_comments" ("task_id") `,
    );
    await q.query(
      `CREATE TABLE "task_files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "task_id" uuid NOT NULL, "file_name" character varying(200) NOT NULL, "mime_type" character varying(100) NOT NULL, "size" integer NOT NULL, "sha256" character varying(64) NOT NULL, "stored_name" character varying(100) NOT NULL, "uploaded_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ef0155509609893f1c0cb9811a8" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_e302f4010ff50a1e8199a48909" ON "task_files" ("task_id") `,
    );
    await q.query(
      `ALTER TABLE "task_comments" ADD CONSTRAINT "FK_ba9e465cfc707006e60aae59946" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "task_comments" ADD CONSTRAINT "FK_76901a920ba9ec5be8dbd64d747" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "task_files" ADD CONSTRAINT "FK_e302f4010ff50a1e8199a489090" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  /**
   * Rolls back the schema. Ledger rows (including fines and reversals) stay,
   * so balances do not change; queued tasks go back to todo. Discipline
   * records, task comments and task file records are dropped.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "task_files"`);
    await q.query(`DROP TABLE "task_comments"`);
    await q.query(`DROP TYPE "public"."task_comments_kind_enum"`);
    await q.query(`DROP TABLE "discipline_records"`);
    await q.query(`DROP TYPE "public"."discipline_records_type_enum"`);

    await q.query(`DROP INDEX "public"."IDX_da695f16d02317721eb76711fe"`);
    await q.query(
      `ALTER TABLE "points_ledger" DROP CONSTRAINT "UQ_26a6c3b48604df86b106de40a66"`,
    );
    await q.query(`ALTER TABLE "points_ledger" DROP COLUMN "reverses_id"`);
    await q.query(`ALTER TABLE "points_ledger" DROP COLUMN "created_by_id"`);
    await q.query(`ALTER TABLE "points_ledger" DROP COLUMN "kind"`);
    await q.query(`DROP TYPE "public"."points_ledger_kind_enum"`);

    await q.query(
      `UPDATE "tasks" SET "status" = 'todo' WHERE "status" = 'queued'`,
    );
    await q.query(
      `CREATE TYPE "public"."tasks_status_enum_old" AS ENUM('todo', 'in_progress', 'review', 'done')`,
    );
    await q.query(`ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT`);
    await q.query(
      `ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "public"."tasks_status_enum_old" USING "status"::text::"public"."tasks_status_enum_old"`,
    );
    await q.query(`DROP TYPE "public"."tasks_status_enum"`);
    await q.query(
      `ALTER TYPE "public"."tasks_status_enum_old" RENAME TO "tasks_status_enum"`,
    );
    await q.query(
      `ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'todo'`,
    );
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "updated_at"`);
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "max_assignees"`);

    await q.query(
      `ALTER TABLE "task_assignees" DROP CONSTRAINT "FK_bb8051e376a2b083e074678cb60"`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" DROP CONSTRAINT "FK_0141288f2306f20da9a60ec8d69"`,
    );
    await q.query(`DROP INDEX "public"."IDX_bb8051e376a2b083e074678cb6"`);
    await q.query(
      `ALTER TABLE "task_assignees" DROP CONSTRAINT "PK_7ae8012667c1cc4ca8266002afc"`,
    );
    await q.query(`ALTER TABLE "task_assignees" DROP COLUMN "taken_at"`);
    await q.query(
      `ALTER TABLE "task_assignees" RENAME COLUMN "user_id" TO "usersId"`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" RENAME COLUMN "task_id" TO "tasksId"`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "PK_71259eff171eb323f416cd3b74d" PRIMARY KEY ("tasksId", "usersId")`,
    );
    await q.query(
      `CREATE INDEX "IDX_e54b42e47461564bc4b18b8f93" ON "task_assignees" ("usersId") `,
    );
    await q.query(
      `CREATE INDEX "IDX_836169568c5c001ee34e7aa78f" ON "task_assignees" ("tasksId") `,
    );
    await q.query(
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_e54b42e47461564bc4b18b8f933" FOREIGN KEY ("usersId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_836169568c5c001ee34e7aa78f7" FOREIGN KEY ("tasksId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }
}
