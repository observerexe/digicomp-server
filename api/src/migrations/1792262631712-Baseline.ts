import { MigrationInterface, QueryRunner } from "typeorm";

export class Baseline1792262631712 implements MigrationInterface {
    name = 'Baseline1792262631712'

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('users')) return;
        await queryRunner.query(`CREATE TABLE "audit_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actor_id" uuid, "action" character varying NOT NULL, "entity" character varying NOT NULL, "entity_id" character varying, "meta" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_07fefa57f7f5ab8fc3f52b3ed0b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."places_status_enum" AS ENUM('active', 'maintenance', 'archived')`);
        await queryRunner.query(`CREATE TABLE "places" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(60) NOT NULL, "title" character varying(200) NOT NULL, "category" character varying(100) NOT NULL, "location" character varying(200) NOT NULL DEFAULT '', "description" text NOT NULL DEFAULT '', "status" "public"."places_status_enum" NOT NULL DEFAULT 'active', "needs_authorization" boolean NOT NULL DEFAULT true, "exclusive" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a6fe963f6700cb1fe4e68002725" UNIQUE ("code"), CONSTRAINT "PK_1afab86e226b4c3bc9a74465c12" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."documents_access_scope_enum" AS ENUM('members', 'supervisors')`);
        await queryRunner.query(`CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(200) NOT NULL, "category" character varying(100) NOT NULL, "description" text NOT NULL DEFAULT '', "access_scope" "public"."documents_access_scope_enum" NOT NULL DEFAULT 'members', "place_id" uuid, "inventory_item_id" uuid, "author_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "document_versions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "doc_id" uuid NOT NULL, "version" integer NOT NULL, "file_name" character varying(200) NOT NULL, "mime_type" character varying(100) NOT NULL, "size" integer NOT NULL, "sha256" character varying(64) NOT NULL, "stored_name" character varying(100) NOT NULL, "change_note" character varying(500) NOT NULL DEFAULT '', "uploaded_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_609a7550b80541f8e78e461ceb7" UNIQUE ("doc_id", "version"), CONSTRAINT "PK_baf26dab035c6d6fc433f9dc6a2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_63d423cdad501805a6a818daff" ON "document_versions"  ("doc_id") `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'coordinator', 'member', 'guest')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "name" character varying NOT NULL, "password_hash" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'member', "position" character varying(100) NOT NULL DEFAULT '', "specialty" character varying(200) NOT NULL DEFAULT '', "bio" text NOT NULL DEFAULT '', "avatar_url" character varying, "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "inventory_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(60) NOT NULL, "title" character varying(200) NOT NULL, "category" character varying(100) NOT NULL, "quantity" numeric(12,3) NOT NULL DEFAULT '0', "unit" character varying(20) NOT NULL DEFAULT 'шт', "min_quantity" numeric(12,3) NOT NULL DEFAULT '0', "location" character varying(200) NOT NULL DEFAULT '', "notes" text NOT NULL DEFAULT '', "created_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_0f18921d7116468ac6932644383" UNIQUE ("code"), CONSTRAINT "CHK_28b152346d65e083171fdbd408" CHECK ("min_quantity" >= 0), CONSTRAINT "CHK_39595620438227c4bc7676c389" CHECK ("quantity" >= 0), CONSTRAINT "PK_cf2f451407242e132547ac19169" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "inventory_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "item_id" uuid NOT NULL, "delta" numeric(12,3) NOT NULL, "quantity_after" numeric(12,3) NOT NULL, "note" character varying(500) NOT NULL, "project_id" uuid, "actor_id" uuid NOT NULL, "idempotency_key" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_7e317d46b8753f86344cb053ba" CHECK ("delta" <> 0), CONSTRAINT "PK_d7597827c1dcffae889db3ab873" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "inventory_movement_idempotency" ON "inventory_movements"  ("actor_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_af5dc9e1cebfc0b4ffee56ba0c" ON "inventory_movements"  ("item_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "place_authorizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "place_id" uuid NOT NULL, "granted_by_id" uuid NOT NULL, "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE, "note" character varying(500) NOT NULL DEFAULT '', CONSTRAINT "UQ_da8a79df5201205dcc86f796133" UNIQUE ("user_id", "place_id"), CONSTRAINT "PK_8e24694c10e399c4fe789588bcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "work_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "place_id" uuid NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ended_at" TIMESTAMP WITH TIME ZONE, "ended_by_id" uuid, "safety_confirmed" boolean NOT NULL, "note" character varying(1000) NOT NULL DEFAULT '', "equipment_state" character varying(200) NOT NULL DEFAULT '', "end_reason" character varying(500) NOT NULL DEFAULT '', "idempotency_key" character varying(64), CONSTRAINT "PK_2b15ef494243f1cc2bf0f731e76" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3ec5dccbed4bfe8633d55d2138" ON "work_sessions"  ("place_id", "started_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "work_session_idempotency" ON "work_sessions"  ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "one_active_session_per_user" ON "work_sessions"  ("user_id") WHERE "ended_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "points_ledger" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "amount" integer NOT NULL, "reason" character varying NOT NULL, "task_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_edface609c5a2542fe1d29648d5" UNIQUE ("user_id", "task_id"), CONSTRAINT "PK_1894c07f712716bfe637e82cc05" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "projects" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(160) NOT NULL, "description" text NOT NULL DEFAULT '', "status" character varying(60) NOT NULL DEFAULT 'Планується', "progress" integer NOT NULL DEFAULT '0', "accomplishments" text NOT NULL DEFAULT '', "sources" jsonb NOT NULL DEFAULT '[]', "created_by_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_c33170347d041b4cc9185d74ab" CHECK ("progress" >= 0 AND "progress" <= 100), CONSTRAINT "PK_6271df0a7aed1d6c0691ce6ac50" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "project_members" ("project_id" uuid NOT NULL, "user_id" uuid NOT NULL, "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b3f491d3a3f986106d281d8eb4b" PRIMARY KEY ("project_id", "user_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e89aae80e010c2faa72e6a49ce" ON "project_members"  ("user_id") `);
        await queryRunner.query(`CREATE TABLE "project_files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "project_id" uuid NOT NULL, "file_name" character varying(200) NOT NULL, "mime_type" character varying(100) NOT NULL, "size" integer NOT NULL, "sha256" character varying(64) NOT NULL, "stored_name" character varying(100) NOT NULL, "uploaded_by_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ba9b1f07ba163e0e21f72f4e02b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_16a580442d8d941e71fd5dbd68" ON "project_files"  ("project_id") `);
        await queryRunner.query(`CREATE TABLE "refresh_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "family_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP NOT NULL, "revoked_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9190032f6967b7971dca07d69f3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a7ab4fd82c654c85b9de53d971" ON "refresh_sessions"  ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_f22ad614014a610b9851827b84" ON "refresh_sessions"  ("family_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d76f5941d821678137ef15d965" ON "refresh_sessions"  ("token_hash") `);
        await queryRunner.query(`CREATE TYPE "public"."tasks_status_enum" AS ENUM('todo', 'in_progress', 'review', 'done')`);
        await queryRunner.query(`CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "description" text, "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'todo', "points" integer NOT NULL DEFAULT '0', "due_date" TIMESTAMP, "created_by_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "completed_at" TIMESTAMP, CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "task_assignees" ("tasksId" uuid NOT NULL, "usersId" uuid NOT NULL, CONSTRAINT "PK_71259eff171eb323f416cd3b74d" PRIMARY KEY ("tasksId", "usersId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_836169568c5c001ee34e7aa78f" ON "task_assignees"  ("tasksId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e54b42e47461564bc4b18b8f93" ON "task_assignees"  ("usersId") `);
        await queryRunner.query(`ALTER TABLE "documents" ADD CONSTRAINT "FK_e74e445cfe0098a4ecc7b52455f" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "document_versions" ADD CONSTRAINT "FK_63d423cdad501805a6a818daffd" FOREIGN KEY ("doc_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_f28fdb1aa1d51974cfbf3ff52f8" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" ADD CONSTRAINT "FK_a2ed901ee4fdf7ca0c384fc6dab" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "place_authorizations" ADD CONSTRAINT "FK_e8243002220462566aa32fec4ef" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "place_authorizations" ADD CONSTRAINT "FK_4b0cfd23b4383409b925193c0e9" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "work_sessions" ADD CONSTRAINT "FK_4dfb452d1af3bae425933010980" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "work_sessions" ADD CONSTRAINT "FK_a3cdf306a1940a937458b8f1668" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "project_members" ADD CONSTRAINT "FK_b5729113570c20c7e214cf3f58d" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "project_members" ADD CONSTRAINT "FK_e89aae80e010c2faa72e6a49ce8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "project_files" ADD CONSTRAINT "FK_16a580442d8d941e71fd5dbd687" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_836169568c5c001ee34e7aa78f7" FOREIGN KEY ("tasksId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "task_assignees" ADD CONSTRAINT "FK_e54b42e47461564bc4b18b8f933" FOREIGN KEY ("usersId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "task_assignees" DROP CONSTRAINT "FK_e54b42e47461564bc4b18b8f933"`);
        await queryRunner.query(`ALTER TABLE "task_assignees" DROP CONSTRAINT "FK_836169568c5c001ee34e7aa78f7"`);
        await queryRunner.query(`ALTER TABLE "project_files" DROP CONSTRAINT "FK_16a580442d8d941e71fd5dbd687"`);
        await queryRunner.query(`ALTER TABLE "project_members" DROP CONSTRAINT "FK_e89aae80e010c2faa72e6a49ce8"`);
        await queryRunner.query(`ALTER TABLE "project_members" DROP CONSTRAINT "FK_b5729113570c20c7e214cf3f58d"`);
        await queryRunner.query(`ALTER TABLE "work_sessions" DROP CONSTRAINT "FK_a3cdf306a1940a937458b8f1668"`);
        await queryRunner.query(`ALTER TABLE "work_sessions" DROP CONSTRAINT "FK_4dfb452d1af3bae425933010980"`);
        await queryRunner.query(`ALTER TABLE "place_authorizations" DROP CONSTRAINT "FK_4b0cfd23b4383409b925193c0e9"`);
        await queryRunner.query(`ALTER TABLE "place_authorizations" DROP CONSTRAINT "FK_e8243002220462566aa32fec4ef"`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_a2ed901ee4fdf7ca0c384fc6dab"`);
        await queryRunner.query(`ALTER TABLE "inventory_movements" DROP CONSTRAINT "FK_f28fdb1aa1d51974cfbf3ff52f8"`);
        await queryRunner.query(`ALTER TABLE "document_versions" DROP CONSTRAINT "FK_63d423cdad501805a6a818daffd"`);
        await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT "FK_e74e445cfe0098a4ecc7b52455f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e54b42e47461564bc4b18b8f93"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_836169568c5c001ee34e7aa78f"`);
        await queryRunner.query(`DROP TABLE "task_assignees"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
        await queryRunner.query(`DROP TYPE "public"."tasks_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d76f5941d821678137ef15d965"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f22ad614014a610b9851827b84"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a7ab4fd82c654c85b9de53d971"`);
        await queryRunner.query(`DROP TABLE "refresh_sessions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_16a580442d8d941e71fd5dbd68"`);
        await queryRunner.query(`DROP TABLE "project_files"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e89aae80e010c2faa72e6a49ce"`);
        await queryRunner.query(`DROP TABLE "project_members"`);
        await queryRunner.query(`DROP TABLE "projects"`);
        await queryRunner.query(`DROP TABLE "points_ledger"`);
        await queryRunner.query(`DROP INDEX "public"."one_active_session_per_user"`);
        await queryRunner.query(`DROP INDEX "public"."work_session_idempotency"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3ec5dccbed4bfe8633d55d2138"`);
        await queryRunner.query(`DROP TABLE "work_sessions"`);
        await queryRunner.query(`DROP TABLE "place_authorizations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_af5dc9e1cebfc0b4ffee56ba0c"`);
        await queryRunner.query(`DROP INDEX "public"."inventory_movement_idempotency"`);
        await queryRunner.query(`DROP TABLE "inventory_movements"`);
        await queryRunner.query(`DROP TABLE "inventory_items"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_63d423cdad501805a6a818daff"`);
        await queryRunner.query(`DROP TABLE "document_versions"`);
        await queryRunner.query(`DROP TABLE "documents"`);
        await queryRunner.query(`DROP TYPE "public"."documents_access_scope_enum"`);
        await queryRunner.query(`DROP TABLE "places"`);
        await queryRunner.query(`DROP TYPE "public"."places_status_enum"`);
        await queryRunner.query(`DROP TABLE "audit_log"`);
    }

}
