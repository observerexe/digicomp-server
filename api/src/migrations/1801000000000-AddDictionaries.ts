import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 0.1а: dictionaries (task types, categories…) and their items.
 * Only new tables; existing rows are not changed. Titles are unique ignoring
 * case: within the list of dictionaries and within one dictionary.
 */
export class AddDictionaries1801000000000 implements MigrationInterface {
  name = 'AddDictionaries1801000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "dictionaries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying(40) NOT NULL, "title" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_5d8cc1c53f99db0dcafde98031a" UNIQUE ("key"), CONSTRAINT "PK_b864abffe7546b378d6ce4ba7c6" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_dictionaries_title" ON "dictionaries" (lower("title"))`,
    );
    await q.query(
      `CREATE TABLE "dictionary_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dictionary_id" uuid NOT NULL, "key" character varying(40) NOT NULL, "title" character varying(100) NOT NULL, "color" character varying(16) NOT NULL DEFAULT 'gray', "position" integer NOT NULL, "archived_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_dictionary_items_key" UNIQUE ("dictionary_id", "key"), CONSTRAINT "PK_ae9772b7c6fee8835b8a9230f89" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_dictionary_items_title" ON "dictionary_items" ("dictionary_id", lower("title"))`,
    );
    await q.query(
      `ALTER TABLE "dictionary_items" ADD CONSTRAINT "FK_480c7bcc1697ed1340f58a38deb" FOREIGN KEY ("dictionary_id") REFERENCES "dictionaries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "dictionary_items"`);
    await q.query(`DROP TABLE "dictionaries"`);
  }
}
