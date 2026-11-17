import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 6.7а: «Зображення» in documents and templates. `paper_images` —
 * a PNG or JPEG in the storage (`paper-images/<id>.png|jpg`), by who and
 * when; `paper_image_uses` — which document or template version holds it
 * (who sees an image follows them; one nothing holds is deleted a day
 * later). Nothing moves here: no document holds an image yet.
 */
export class PaperImages1832000000000 implements MigrationInterface {
  name = 'PaperImages1832000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "paper_images" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "mime_type" character varying(20) NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "size" integer NOT NULL, "sha256" character(64) NOT NULL, "uploaded_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ecbf7142165eca7137d49cba0b9" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_f51a13f1cfb9b3a0a2491be14f" ON "paper_images"  ("created_at") `,
    );
    await q.query(
      `CREATE TABLE "paper_image_uses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "image_id" uuid NOT NULL, "paper_id" uuid, "template_version_id" uuid, CONSTRAINT "CHK_paper_image_uses_owner" CHECK (num_nonnulls("paper_id", "template_version_id") = 1), CONSTRAINT "PK_22f294452c2d4f11da5d04dcfd1" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_0d421a394611c7d9d256c6a925" ON "paper_image_uses"  ("paper_id") `,
    );
    await q.query(
      `CREATE INDEX "IDX_90a29ecab2ffa1274642139c64" ON "paper_image_uses"  ("template_version_id") `,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_paper_image_uses_version" ON "paper_image_uses"  ("image_id", "template_version_id") `,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_paper_image_uses_paper" ON "paper_image_uses"  ("image_id", "paper_id") `,
    );
    await q.query(
      `ALTER TABLE "paper_images" ADD CONSTRAINT "FK_396c7fd8fcbbf4d2fd57dda30da" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_image_uses" ADD CONSTRAINT "FK_0b24c489cfaa9ae18c894cb1efc" FOREIGN KEY ("image_id") REFERENCES "paper_images"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_image_uses" ADD CONSTRAINT "FK_0d421a394611c7d9d256c6a925a" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "paper_image_uses" ADD CONSTRAINT "FK_90a29ecab2ffa1274642139c646" FOREIGN KEY ("template_version_id") REFERENCES "paper_template_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  /**
   * The tables go; documents keep their image nodes (an image then is not
   * found) and the files stay in the storage.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "paper_image_uses" DROP CONSTRAINT "FK_90a29ecab2ffa1274642139c646"`,
    );
    await q.query(
      `ALTER TABLE "paper_image_uses" DROP CONSTRAINT "FK_0d421a394611c7d9d256c6a925a"`,
    );
    await q.query(
      `ALTER TABLE "paper_image_uses" DROP CONSTRAINT "FK_0b24c489cfaa9ae18c894cb1efc"`,
    );
    await q.query(
      `ALTER TABLE "paper_images" DROP CONSTRAINT "FK_396c7fd8fcbbf4d2fd57dda30da"`,
    );
    await q.query(`DROP INDEX "public"."UQ_paper_image_uses_paper"`);
    await q.query(`DROP INDEX "public"."UQ_paper_image_uses_version"`);
    await q.query(`DROP INDEX "public"."IDX_90a29ecab2ffa1274642139c64"`);
    await q.query(`DROP INDEX "public"."IDX_0d421a394611c7d9d256c6a925"`);
    await q.query(`DROP TABLE "paper_image_uses"`);
    await q.query(`DROP INDEX "public"."IDX_f51a13f1cfb9b3a0a2491be14f"`);
    await q.query(`DROP TABLE "paper_images"`);
  }
}
