import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 3: bookings without overlaps, fault reports with photos,
 * auto-closed sessions, project stages and dates.
 *
 * Keeps all data: project free-text status is mapped to a fixed stage by
 * keywords (unknown -> planning) and the original text of every project is
 * written to audit_log (project.stage_migrated) before the column is dropped.
 */
export class LabBookingsFaultsProjectStages1796000000000 implements MigrationInterface {
  name = 'LabBookingsFaultsProjectStages1796000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
    await q.query(
      `CREATE TABLE "bookings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "place_id" uuid NOT NULL, "user_id" uuid NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "note" character varying(500) NOT NULL DEFAULT '', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancelled_by_id" uuid, "cancel_reason" character varying(500) NOT NULL DEFAULT '', CONSTRAINT "CHK_f41dd0e4ed602332934a66f999" CHECK ("ends_at" > "starts_at"), CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("place_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("cancelled_at" IS NULL), CONSTRAINT "PK_bee6805982cc1e248e94ce94957" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_64cd97487c5c42806458ab5520" ON "bookings"  ("user_id") `,
    );
    await q.query(
      `CREATE INDEX "IDX_56bdf5c55fbc1830a0c175dae6" ON "bookings"  ("place_id", "starts_at") `,
    );
    await q.query(
      `CREATE TYPE "public"."fault_reports_status_enum" AS ENUM('open', 'in_progress', 'closed')`,
    );
    await q.query(
      `CREATE TABLE "fault_reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "place_id" uuid NOT NULL, "reporter_id" uuid NOT NULL, "description" text NOT NULL, "status" "public"."fault_reports_status_enum" NOT NULL DEFAULT 'open', "resolution" text NOT NULL DEFAULT '', "closed_by_id" uuid, "closed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_534b3f9c35a383c2345e4006393" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_8442a0d09811ab4019414a79f6" ON "fault_reports"  ("place_id", "status") `,
    );
    await q.query(
      `CREATE TABLE "fault_photos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fault_id" uuid NOT NULL, "mime_type" character varying(100) NOT NULL, "size" integer NOT NULL, "stored_name" character varying(100) NOT NULL, "uploaded_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8e91da5e3943944645f01a8b887" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_8662dacf4878fafb7e07610a4e" ON "fault_photos"  ("fault_id") `,
    );
    await q.query(
      `ALTER TABLE "work_sessions" ADD "auto_closed" boolean NOT NULL DEFAULT false`,
    );
    await q.query(
      `CREATE TYPE "public"."projects_stage_enum" AS ENUM('idea', 'planning', 'execution', 'review', 'done')`,
    );
    await q.query(
      `ALTER TABLE "projects" ADD "stage" "public"."projects_stage_enum" NOT NULL DEFAULT 'planning'`,
    );
    await q.query(`ALTER TABLE "projects" ADD "start_date" date`);
    await q.query(`ALTER TABLE "projects" ADD "deadline" date`);

    // Free-text status -> fixed stage. The old text is kept in the audit log.
    await q.query(
      `UPDATE "projects" SET "stage" = (CASE
         WHEN lower("status") ~* '(заверш|готов|виконано|закінч|done|finish)' THEN 'done'
         WHEN lower("status") ~* '(перевір|тест|рев.ю|review)' THEN 'review'
         WHEN lower("status") ~* '(робот|викон|процес|актив|progress)' THEN 'execution'
         WHEN lower("status") ~* '(ідея|idea)' THEN 'idea'
         ELSE 'planning' END)::"public"."projects_stage_enum"`,
    );
    await q.query(
      `INSERT INTO "audit_log" ("action", "entity", "entity_id", "meta")
       SELECT 'project.stage_migrated', 'project', "id"::text,
              jsonb_build_object('oldStatus', "status", 'stage', "stage")
       FROM "projects"`,
    );
    await q.query(`ALTER TABLE "projects" DROP COLUMN "status"`);
    await q.query(
      `ALTER TABLE "bookings" ADD CONSTRAINT "FK_76f3ab8104f5f947057760659c5" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "bookings" ADD CONSTRAINT "FK_64cd97487c5c42806458ab5520c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "fault_reports" ADD CONSTRAINT "FK_c5cc77cc60958f7552277d68dbd" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "fault_reports" ADD CONSTRAINT "FK_53c2e4cedecd8e50506abe1931c" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "fault_photos" ADD CONSTRAINT "FK_8662dacf4878fafb7e07610a4ec" FOREIGN KEY ("fault_id") REFERENCES "fault_reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  /**
   * Restores the free-text status from the stage (original text stays in the
   * audit log). Bookings, fault reports and photos records are dropped.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "fault_photos" DROP CONSTRAINT "FK_8662dacf4878fafb7e07610a4ec"`,
    );
    await q.query(
      `ALTER TABLE "fault_reports" DROP CONSTRAINT "FK_53c2e4cedecd8e50506abe1931c"`,
    );
    await q.query(
      `ALTER TABLE "fault_reports" DROP CONSTRAINT "FK_c5cc77cc60958f7552277d68dbd"`,
    );
    await q.query(
      `ALTER TABLE "bookings" DROP CONSTRAINT "FK_64cd97487c5c42806458ab5520c"`,
    );
    await q.query(
      `ALTER TABLE "bookings" DROP CONSTRAINT "FK_76f3ab8104f5f947057760659c5"`,
    );
    await q.query(
      `ALTER TABLE "projects" ADD "status" character varying(60) NOT NULL DEFAULT 'Планується'`,
    );
    await q.query(
      `UPDATE "projects" SET "status" = CASE "stage"
         WHEN 'idea' THEN 'Ідея' WHEN 'planning' THEN 'Планується'
         WHEN 'execution' THEN 'В роботі' WHEN 'review' THEN 'На перевірці'
         WHEN 'done' THEN 'Завершено' END`,
    );
    await q.query(`ALTER TABLE "projects" DROP COLUMN "deadline"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "start_date"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "stage"`);
    await q.query(`DROP TYPE "public"."projects_stage_enum"`);
    await q.query(`ALTER TABLE "work_sessions" DROP COLUMN "auto_closed"`);
    await q.query(`DROP TABLE "fault_photos"`);
    await q.query(`DROP TABLE "fault_reports"`);
    await q.query(`DROP TYPE "public"."fault_reports_status_enum"`);
    await q.query(`DROP TABLE "bookings"`);
  }
}
