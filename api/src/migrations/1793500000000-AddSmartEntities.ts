import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmartEntities1793500000000 implements MigrationInterface {
  name = 'AddSmartEntities1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."smart_entities_kind_enum" AS ENUM('light', 'sensor', 'scene')`,
    );
    await queryRunner.query(
      `CREATE TABLE "smart_entities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "entity_id" character varying(120) NOT NULL, "kind" "public"."smart_entities_kind_enum" NOT NULL, "label" character varying(120) NOT NULL, "room" character varying(120) NOT NULL DEFAULT '', "enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_1aa37d39801e6d764d41a4541dc" UNIQUE ("entity_id"), CONSTRAINT "PK_5dabba964b2ce6a8545bbf7cab6" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "smart_entities"`);
    await queryRunner.query(`DROP TYPE "public"."smart_entities_kind_enum"`);
  }
}
