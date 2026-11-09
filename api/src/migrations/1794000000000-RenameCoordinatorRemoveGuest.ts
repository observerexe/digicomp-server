import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 1 roles: coordinator -> moderator, guest removed.
 * Former guests become blocked members (active=false) and lose their refresh
 * sessions; the conversion is recorded in audit_log (one row per user).
 *
 * down() restores the old enum, but former guests stay blocked members:
 * they can be found by the audit rows with action 'user.guest_converted'.
 */
export class RenameCoordinatorRemoveGuest1794000000000 implements MigrationInterface {
  name = 'RenameCoordinatorRemoveGuest1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" RENAME VALUE 'coordinator' TO 'moderator'`,
    );
    await queryRunner.query(
      `INSERT INTO "audit_log" ("actor_id", "action", "entity", "entity_id", "meta")
       SELECT NULL, 'user.guest_converted', 'user', "id"::text,
              jsonb_build_object('from', 'guest', 'to', 'member', 'activeBefore', "active")
       FROM "users" WHERE "role" = 'guest'`,
    );
    await queryRunner.query(
      `DELETE FROM "refresh_sessions" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" = 'guest')`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'member', "active" = false WHERE "role" = 'guest'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'moderator', 'member')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::text::"public"."users_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member'`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'coordinator', 'member', 'guest')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum"
       USING (CASE "role"::text WHEN 'moderator' THEN 'coordinator' ELSE "role"::text END)::"public"."users_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member'`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_old"`);
  }
}
