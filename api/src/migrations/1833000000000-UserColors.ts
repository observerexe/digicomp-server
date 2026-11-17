import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 6.7е: the colour of an account — a name from the palette
 * (docs/design/tokens.json), its shade everywhere the person is shown. Who
 * is already here gets one in turn, by the day they joined (gray — only by
 * choice): `ACCOUNT_COLORS` of dictionaries/palette.ts, in the same order.
 */
export class UserColors1833000000000 implements MigrationInterface {
  name = 'UserColors1833000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "users" ADD "color" character varying(16) NOT NULL DEFAULT 'blue'`,
    );
    await q.query(
      `UPDATE "users" SET "color" = (ARRAY['blue','green','orange','purple','teal','red','yellow'])[((n - 1) % 7) + 1]
       FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "users") AS turn
       WHERE "users"."id" = turn."id"`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN "color"`);
  }
}
