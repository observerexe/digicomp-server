import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 0.3а: extra fields of record types and `tasks.extra` for their
 * values. Existing tasks get an empty object; nothing else changes.
 * Labels are unique ignoring case within a record type.
 */
export class RecordFieldDefs1803000000000 implements MigrationInterface {
  name = 'RecordFieldDefs1803000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "record_field_defs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "record_type" character varying(40) NOT NULL, "key" character varying(40) NOT NULL, "label" character varying(100) NOT NULL, "type" character varying(20) NOT NULL, "required" boolean NOT NULL DEFAULT false, "dictionary" character varying(40), "min" double precision, "max" double precision, "max_length" integer, "max_items" integer, "position" integer NOT NULL, "archived_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_record_field_defs_key" UNIQUE ("record_type", "key"), CONSTRAINT "PK_9d6dd6da4042d493b3dae2b8e05" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_record_field_defs_label" ON "record_field_defs" ("record_type", lower("label"))`,
    );
    await q.query(
      `ALTER TABLE "record_field_defs" ADD CONSTRAINT "FK_06d25df44916cdffc4cdd302cb1" FOREIGN KEY ("dictionary") REFERENCES "dictionaries"("key") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "tasks" ADD "extra" jsonb NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "tasks" DROP COLUMN "extra"`);
    await q.query(`DROP TABLE "record_field_defs"`);
  }
}
