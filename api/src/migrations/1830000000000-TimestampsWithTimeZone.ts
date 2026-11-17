import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The last columns kept as `timestamp without time zone` become
 * `timestamptz`, as every other one. Their values were written in UTC (the
 * database's `now()`, and the API in Docker runs in UTC): they are read as
 * UTC. Down: back to UTC wall time, nothing is lost.
 */
const COLUMNS: [table: string, column: string][] = [
  ['audit_log', 'created_at'],
  ['points_ledger', 'created_at'],
  ['refresh_sessions', 'created_at'],
  ['refresh_sessions', 'expires_at'],
  ['refresh_sessions', 'revoked_at'],
  ['tasks', 'completed_at'],
  ['tasks', 'created_at'],
  ['tasks', 'due_date'],
  ['users', 'created_at'],
];

export class TimestampsWithTimeZone1830000000000 implements MigrationInterface {
  name = 'TimestampsWithTimeZone1830000000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [table, column] of COLUMNS) {
      await q.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [table, column] of COLUMNS) {
      await q.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }
}
