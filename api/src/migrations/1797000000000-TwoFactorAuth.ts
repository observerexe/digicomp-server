import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 4: two-factor authentication (TOTP) and the 2FA flag of refresh
 * sessions. Only new columns with defaults; existing rows are not changed.
 */
export class TwoFactorAuth1797000000000 implements MigrationInterface {
  name = 'TwoFactorAuth1797000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD "totp_secret_enc" text`);
    await q.query(
      `ALTER TABLE "users" ADD "totp_enabled_at" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(`ALTER TABLE "users" ADD "totp_last_step" integer`);
    await q.query(
      `ALTER TABLE "users" ADD "totp_failed_attempts" integer NOT NULL DEFAULT '0'`,
    );
    await q.query(
      `ALTER TABLE "users" ADD "totp_locked_until" TIMESTAMP WITH TIME ZONE`,
    );
    await q.query(
      `ALTER TABLE "users" ADD "recovery_codes" jsonb NOT NULL DEFAULT '[]'`,
    );
    await q.query(
      `ALTER TABLE "refresh_sessions" ADD "mfa" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "refresh_sessions" DROP COLUMN "mfa"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "recovery_codes"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "totp_locked_until"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "totp_failed_attempts"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "totp_last_step"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "totp_enabled_at"`);
    await q.query(`ALTER TABLE "users" DROP COLUMN "totp_secret_enc"`);
  }
}
