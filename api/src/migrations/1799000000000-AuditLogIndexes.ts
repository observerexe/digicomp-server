import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pre-launch: the audit journal only grows, and every page of GET /audit
 * sorted the whole table. Indexes for the order (created_at, id) and the
 * actor filter. Only indexes are added; no rows change.
 */
export class AuditLogIndexes1799000000000 implements MigrationInterface {
  name = 'AuditLogIndexes1799000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE INDEX "IDX_audit_log_created_id" ON "audit_log" ("created_at", "id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_audit_log_actor_created" ON "audit_log" ("actor_id", "created_at", "id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."IDX_audit_log_actor_created"`);
    await q.query(`DROP INDEX "public"."IDX_audit_log_created_id"`);
  }
}
