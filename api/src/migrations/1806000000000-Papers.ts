import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 1.1: editor documents. Only a new table: existing rows are not
 * changed. Template, record and number columns come with their sessions.
 */
export class Papers1806000000000 implements MigrationInterface {
  name = 'Papers1806000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "public"."papers_status_enum" AS ENUM('draft', 'published', 'frozen', 'signed', 'cancelled')`,
    );
    await q.query(
      `CREATE TYPE "public"."papers_visibility_enum" AS ENUM('author', 'members')`,
    );
    await q.query(
      `CREATE TABLE "papers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(200) NOT NULL, "content" jsonb NOT NULL, "status" "public"."papers_status_enum" NOT NULL DEFAULT 'draft', "visibility" "public"."papers_visibility_enum" NOT NULL DEFAULT 'author', "revision" integer NOT NULL DEFAULT '1', "author_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_17518c36f185ea42ddc59eeb8a8" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_papers_updated" ON "papers" ("updated_at")`,
    );
    await q.query(
      `CREATE INDEX "IDX_papers_author_updated" ON "papers" ("author_id", "updated_at")`,
    );
    await q.query(
      `ALTER TABLE "papers" ADD CONSTRAINT "FK_0333b764d76fb854fc09ebfa011" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "papers"`);
    await q.query(`DROP TYPE "public"."papers_visibility_enum"`);
    await q.query(`DROP TYPE "public"."papers_status_enum"`);
  }
}
