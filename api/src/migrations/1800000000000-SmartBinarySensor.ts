import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 8.8: on/off sensors (motion, leak, door) can be allowed, read only.
 * Only a new enum value is added; no rows change. `down` removes the value,
 * and with it the binary_sensor rows (they cannot exist in the old type).
 */
export class SmartBinarySensor1800000000000 implements MigrationInterface {
  name = 'SmartBinarySensor1800000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TYPE "public"."smart_entities_kind_enum" ADD VALUE IF NOT EXISTS 'binary_sensor'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "smart_entities" WHERE "kind" = 'binary_sensor'`,
    );
    await q.query(
      `ALTER TYPE "public"."smart_entities_kind_enum" RENAME TO "smart_entities_kind_enum_old"`,
    );
    await q.query(
      `CREATE TYPE "public"."smart_entities_kind_enum" AS ENUM('light', 'sensor', 'scene')`,
    );
    await q.query(
      `ALTER TABLE "smart_entities" ALTER COLUMN "kind" TYPE "public"."smart_entities_kind_enum" USING "kind"::text::"public"."smart_entities_kind_enum"`,
    );
    await q.query(`DROP TYPE "public"."smart_entities_kind_enum_old"`);
  }
}
