import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A document of a template that creates a record is called by the record's
 * name while nobody renamed it (see followedTitle in paperwork.service.ts).
 * Documents made before still carry the template's title («Коротке ТЗ»):
 * they take the name of their record — a task or a project — when their
 * template version has a field bound to `title`. Down: those that still
 * carry their record's name go back to the template's title.
 */
const RECORDS = ['tasks', 'projects'] as const;
const TYPE: Record<(typeof RECORDS)[number], string> = {
  tasks: 'task',
  projects: 'project',
};

const boundToTitle = `EXISTS (
  SELECT 1 FROM jsonb_array_elements(v.fields) f
   WHERE f ->> 'binding' = 'title'
     AND COALESCE((f ->> 'auto')::boolean, false) = false)`;

export class PaperTitlesFromRecords1831000000000 implements MigrationInterface {
  name = 'PaperTitlesFromRecords1831000000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of RECORDS) {
      await q.query(
        `UPDATE "papers" p SET "title" = LEFT(r."title", 200)
           FROM "paper_template_versions" v, "paper_templates" t, "${table}" r
          WHERE p."template_version_id" = v."id" AND t."id" = v."template_id"
            AND t."kind" = 'creates' AND p."target_type" = $1
            AND r."id" = p."target_id" AND p."title" = t."title"
            AND BTRIM(r."title") <> '' AND ${boundToTitle}`,
        [TYPE[table]],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of RECORDS) {
      await q.query(
        `UPDATE "papers" p SET "title" = t."title"
           FROM "paper_template_versions" v, "paper_templates" t, "${table}" r
          WHERE p."template_version_id" = v."id" AND t."id" = v."template_id"
            AND t."kind" = 'creates' AND p."target_type" = $1
            AND r."id" = p."target_id" AND p."title" = LEFT(r."title", 200)
            AND ${boundToTitle}`,
        [TYPE[table]],
      );
    }
  }
}
