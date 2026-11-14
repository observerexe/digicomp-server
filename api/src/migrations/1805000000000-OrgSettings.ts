import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 0.5: requisites of the organisation for documents — one row.
 * Initial values are the owner's decisions; the default signer is set only
 * if exactly one active user is called "Артур Машталер" (case and spaces
 * ignored), otherwise staff pick them on the "Реквізити" tile.
 * Only a new table: existing rows are not changed.
 */
export class OrgSettings1805000000000 implements MigrationInterface {
  name = 'OrgSettings1805000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "org_settings" ("id" smallint NOT NULL DEFAULT 1, "institution" character varying(200) NOT NULL DEFAULT '', "group_name" character varying(200) NOT NULL DEFAULT '', "signer_id" uuid, "signer_position" character varying(200) NOT NULL DEFAULT '', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_org_settings_single" CHECK ("id" = 1), CONSTRAINT "PK_3726dc3a3dfdcd4f0d95b330789" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `ALTER TABLE "org_settings" ADD CONSTRAINT "FK_c77fc3c914fb4cb12b4b252c665" FOREIGN KEY ("signer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await q.query(
      `INSERT INTO "org_settings" ("id", "institution", "group_name", "signer_id", "signer_position")
       VALUES (1, $1, $2,
         (SELECT CASE WHEN count(*) = 1 THEN min("id"::text)::uuid END FROM "users"
          WHERE "active" AND lower(regexp_replace(btrim("name"), '\\s+', ' ', 'g')) = $3),
         $4)`,
      [
        'КАЛУСЬКИЙ ПОЛІТЕХНІЧНИЙ ФАХОВИЙ КОЛЕДЖ',
        'Творча група DigiComp',
        'артур машталер',
        'модератор творчої групи DigiComp',
      ],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "org_settings"`);
  }
}
