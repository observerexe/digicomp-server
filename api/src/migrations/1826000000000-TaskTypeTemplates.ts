import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TASK_TEMPLATES,
  type TaskTemplate,
} from './1812000000000-TaskTemplates';
import { TASK_TYPE_FIELD } from './1825000000000-TaskTypes';

/**
 * Editor 6.3: «Технічне завдання» and «Коротке ТЗ» get version 2 with the
 * field «Тип» (bound to the task's `type`, required) next to the title: in
 * «Технічне завдання» — a line under the title of the work, in «Коротке ТЗ» —
 * after «Назва». Version 1 stays as it was (published versions never
 * change); its documents are already published or are drafts of a version
 * that now needs an update.
 *
 * Only where version 1 is still the current one and the template has no
 * draft: a template staff changed since needs a new version from them (it
 * shows «потребує оновлення»). The author is the first active admin; on a
 * new installation there is none yet, so `POST /auth/setup` runs this again
 * after TaskTemplates (see seed-templates.ts). A second run changes nothing.
 */

type Node = TaskTemplate['body'];

const typeField: TaskTemplate['fields'][number] = {
  key: TASK_TYPE_FIELD.key,
  label: TASK_TYPE_FIELD.label,
  type: 'enum',
  required: true,
  fill: 'author',
  editable: true,
  print: true,
  binding: TASK_TYPE_FIELD.key,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  dictionary: null,
};

const typeLine = (): Node => ({
  type: 'paragraph',
  attrs: { align: null },
  content: [
    { type: 'text', text: `${TASK_TYPE_FIELD.label}: ` },
    { type: 'field', attrs: { key: TASK_TYPE_FIELD.key } },
  ],
});

/** Holds the field `key` (a paragraph with it, or «Назва: <field>»). */
const holds = (n: Node, key: string) =>
  (n.content ?? []).some((c) => c.type === 'field' && c.attrs?.key === key);

/** Version 1 with «Тип» after the title: the field and the line after the title's paragraph. */
function withType(t: TaskTemplate): Pick<TaskTemplate, 'fields' | 'body'> {
  const at = t.fields.findIndex((f) => f.key === 'title') + 1;
  const content = t.body.content ?? [];
  const line = content.findIndex((n) => holds(n, 'title')) + 1;
  return {
    fields: [...t.fields.slice(0, at), typeField, ...t.fields.slice(at)],
    body: {
      ...t.body,
      content: [...content.slice(0, line), typeLine(), ...content.slice(line)],
    },
  };
}

const VERSION_IDS: Record<string, string> = {
  '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a21':
    '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a23',
  '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a31':
    '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a33',
};

export const TASK_TYPE_TEMPLATES: (TaskTemplate & {
  previousVersionId: string;
})[] = TASK_TEMPLATES.map((t) => ({
  id: t.id,
  title: t.title,
  previousVersionId: t.versionId,
  versionId: VERSION_IDS[t.id],
  ...withType(t),
}));

export class TaskTypeTemplates1826000000000 implements MigrationInterface {
  name = 'TaskTypeTemplates1826000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of TASK_TYPE_TEMPLATES) {
      const ready = (await q.query(
        `SELECT 1 FROM "paper_templates" pt
          WHERE pt."id" = $1 AND pt."current_version_id" = $2
            AND NOT EXISTS (SELECT 1 FROM "paper_template_versions" v
                             WHERE v."template_id" = pt."id" AND v."published_at" IS NULL)`,
        [t.id, t.previousVersionId],
      )) as unknown[];
      if (!ready.length) continue;
      await q.query(
        `INSERT INTO "paper_template_versions" ("id", "template_id", "number", "body", "fields", "published_at", "published_by_id")
         SELECT $1, $2, max("number") + 1, $3, $4, now(), $5
           FROM "paper_template_versions" WHERE "template_id" = $2`,
        [
          t.versionId,
          t.id,
          JSON.stringify(t.body),
          JSON.stringify(t.fields),
          admin.id,
        ],
      );
      await q.query(
        `UPDATE "paper_templates" SET "current_version_id" = $1 WHERE "id" = $2`,
        [t.versionId, t.id],
      );
    }
  }

  /** Version 1 is current again where no document was made from version 2. */
  public async down(q: QueryRunner): Promise<void> {
    for (const t of TASK_TYPE_TEMPLATES) {
      const used = (await q.query(
        `SELECT 1 FROM "papers" WHERE "template_version_id" = $1 LIMIT 1`,
        [t.versionId],
      )) as unknown[];
      if (used.length) continue;
      await q.query(
        `UPDATE "paper_templates" SET "current_version_id" = $1 WHERE "id" = $2 AND "current_version_id" = $3`,
        [t.previousVersionId, t.id, t.versionId],
      );
      await q.query(
        `DELETE FROM "paper_template_versions" WHERE "id" = $1 AND NOT EXISTS (
           SELECT 1 FROM "paper_templates" WHERE "current_version_id" = $1)`,
        [t.versionId],
      );
    }
  }
}
