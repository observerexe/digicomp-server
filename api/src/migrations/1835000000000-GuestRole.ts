import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The guest role again, with clear bounds this time: Розваги, the rating and
 * an overview of tasks and projects (auth/policy.ts). Only adds the value;
 * the former guests of stage 1 stay blocked members.
 *
 * down(): guests become blocked members (as stage 1 did, recorded in the
 * audit as `user.guest_converted`) and the value leaves the enum.
 */
export class GuestRole1835000000000 implements MigrationInterface {
  name = 'GuestRole1835000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'guest'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO "audit_log" ("actor_id", "action", "entity", "entity_id", "meta")
       SELECT NULL, 'user.guest_converted', 'user', "id"::text,
              jsonb_build_object('from', 'guest', 'to', 'member', 'activeBefore', "active")
       FROM "users" WHERE "role" = 'guest'`,
    );
    await q.query(
      `DELETE FROM "refresh_sessions" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" = 'guest')`,
    );
    await q.query(
      `UPDATE "users" SET "role" = 'member', "active" = false WHERE "role" = 'guest'`,
    );
    await q.query(
      `ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`,
    );
    await q.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'moderator', 'member')`,
    );
    await q.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`);
    await q.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::text::"public"."users_role_enum"`,
    );
    await q.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member'`,
    );
    await q.query(`DROP TYPE "public"."users_role_enum_old"`);
  }
}
