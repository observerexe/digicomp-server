import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 2.1: templates of documents and their versions. Only new tables:
 * existing rows are not changed.
 */
export class PaperTemplates1807000000000 implements MigrationInterface {
  name = 'PaperTemplates1807000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "public"."paper_templates_kind_enum" AS ENUM('creates', 'report', 'free')`,
    );
    await q.query(
      `CREATE TYPE "public"."paper_templates_creators_enum" AS ENUM('all', 'staff')`,
    );
    await q.query(
      `CREATE TYPE "public"."paper_templates_visibility_enum" AS ENUM('author', 'members')`,
    );
    await q.query(
      `CREATE TABLE "paper_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(200) NOT NULL, "kind" "public"."paper_templates_kind_enum" NOT NULL, "target" character varying(40), "number_prefix" character varying(10), "auto_freeze" boolean NOT NULL DEFAULT false, "creators" "public"."paper_templates_creators_enum" NOT NULL DEFAULT 'staff', "visibility" "public"."paper_templates_visibility_enum" NOT NULL DEFAULT 'author', "current_version_id" uuid, "archived_at" TIMESTAMP WITH TIME ZONE, "created_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_36ceb3bbb9ee70272474a51d766" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE TABLE "paper_template_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "template_id" uuid NOT NULL, "number" integer NOT NULL, "body" jsonb NOT NULL, "fields" jsonb NOT NULL, "schema_version" character varying(12), "revision" integer NOT NULL DEFAULT '1', "published_at" TIMESTAMP WITH TIME ZONE, "published_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_paper_template_versions_number" UNIQUE ("template_id", "number"), CONSTRAINT "PK_8bf2506d03da5eb23f860adbde8" PRIMARY KEY ("id"))`,
    );
    // At most one draft version a template.
    await q.query(
      `CREATE UNIQUE INDEX "UQ_paper_template_versions_draft" ON "paper_template_versions" ("template_id") WHERE "published_at" IS NULL`,
    );
    await q.query(
      `ALTER TABLE "paper_templates" ADD CONSTRAINT "FK_77bab436eae65bb8457f7ae8d41" FOREIGN KEY ("current_version_id") REFERENCES "paper_template_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_templates" ADD CONSTRAINT "FK_ebaa01828060e5395f47ca9aacb" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_template_versions" ADD CONSTRAINT "FK_260e689e163fe895934365766be" FOREIGN KEY ("template_id") REFERENCES "paper_templates"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_template_versions" ADD CONSTRAINT "FK_cc6b71ca764f32d7d63fc9152e0" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "paper_templates" DROP CONSTRAINT "FK_77bab436eae65bb8457f7ae8d41"`,
    );
    await q.query(`DROP TABLE "paper_template_versions"`);
    await q.query(`DROP TABLE "paper_templates"`);
    await q.query(`DROP TYPE "public"."paper_templates_visibility_enum"`);
    await q.query(`DROP TYPE "public"."paper_templates_creators_enum"`);
    await q.query(`DROP TYPE "public"."paper_templates_kind_enum"`);
  }
}
