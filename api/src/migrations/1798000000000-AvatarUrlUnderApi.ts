import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 8: the API moved under /api in stage 7, so stored avatar URLs
 * `/files/avatars/<id>` now point at a web page. Only the prefix changes;
 * no rows are removed. `down` restores the old form.
 */
export class AvatarUrlUnderApi1798000000000 implements MigrationInterface {
  name = 'AvatarUrlUnderApi1798000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "users" SET "avatar_url" = '/api' || "avatar_url"
       WHERE "avatar_url" LIKE '/files/%'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "users" SET "avatar_url" = regexp_replace("avatar_url", '^/api(/files/[^?]*).*$', '\\1')
       WHERE "avatar_url" LIKE '/api/files/%'`,
    );
  }
}
