import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 3.1г: tasks are created and changed only through documents, so
 * every installation gets the two templates that create them —
 * «Технічне завдання» (by the approved mockup) and «Коротке ТЗ». Both
 * create a task, prefix `ТЗ`, made by staff, seen by everyone, frozen
 * automatically once the task is done; published as version 1. The author
 * is the first active admin; without one (an empty database) nothing is
 * created. Only new rows; a template a revert kept (documents were made
 * from it) is left as it is.
 *
 * `schema_version` stays NULL: the server then checks the bindings against
 * the task's schema of now (a template whose bindings hold is not broken).
 * Bodies and fields are written out here, as they were on this day (a
 * migration never changes); `task-templates.spec.ts` checks them with the
 * same rules a published version must keep.
 */

type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Field = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  fill: 'author';
  editable: boolean;
  print: true;
  binding: string | null;
  min: null;
  max: null;
  maxLength: null;
  maxItems: null;
  dictionary: null;
};
export type TaskTemplate = {
  id: string;
  versionId: string;
  title: string;
  body: Node;
  fields: Field[];
};

/** Filled by the author, changeable after publishing. */
const field = (
  key: string,
  label: string,
  type: string,
  binding: string | null,
  required = false,
): Field => ({
  key,
  label,
  type,
  required,
  fill: 'author',
  editable: true,
  print: true,
  binding,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  dictionary: null,
});
/** Bound to what the task gets later: nobody fills or changes it. */
const auto = (key: string, label: string, type: string, binding: string) => ({
  ...field(key, label, type, binding),
  editable: false,
});

const text = (t: string): Node => ({ type: 'text', text: t });
const fieldNode = (key: string): Node => ({ type: 'field', attrs: { key } });
const paragraph = (content: Node[], align: string | null = null): Node => ({
  type: 'paragraph',
  attrs: { align },
  content,
});
const line = (label: string, key: string): Node =>
  paragraph([text(`${label}: `), fieldNode(key)]);
const heading = (
  level: number,
  content: Node[],
  align: string | null = null,
) => ({
  type: 'heading',
  attrs: { level, align },
  content,
});
const zone = (key: string): Node => ({
  type: 'fieldZone',
  attrs: { key },
  content: [{ type: 'paragraph' }],
});
const cell = (content: Node[]): Node => ({
  type: 'tableCell',
  content: [{ type: 'paragraph', content }],
});
const row = (label: string, key: string): Node => ({
  type: 'tableRow',
  content: [cell([text(label)]), cell([fieldNode(key)])],
});
const title = (): Node =>
  heading(1, [text('ТЕХНІЧНЕ ЗАВДАННЯ '), { type: 'paperNumber' }], 'center');

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a21',
    versionId: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a22',
    title: 'Технічне завдання',
    fields: [
      field('title', 'Назва роботи', 'text', 'title', true),
      field('goal', 'Мета', 'richtext', 'description'),
      field('requirements', 'Вимоги до результату', 'richtext', null),
      field('points', 'Бали за виконання', 'int', 'points', true),
      field('maxAssignees', 'Кількість виконавців', 'int', 'maxAssignees'),
      field('dueDate', 'Термін виконання', 'datetime', 'dueDate'),
      field('place', 'Обладнання', 'ref:place', null),
      field('criteria', 'Критерії приймання', 'richtext', null),
      auto('assignees', 'Виконавці', 'list<ref:user>', 'assignees'),
      auto('pointsSplit', 'Розподіл балів', 'text', 'pointsSplit'),
      auto('acceptedAt', 'Дата приймання', 'datetime', 'completedAt'),
      auto('acceptedBy', 'Роботу прийняв', 'ref:user', 'acceptedById'),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        { type: 'approval' },
        title(),
        paragraph([text('на виконання робіт')], 'center'),
        heading(2, [text('1. Назва роботи')]),
        paragraph([fieldNode('title')]),
        heading(2, [text('2. Мета')]),
        zone('goal'),
        heading(2, [text('3. Вимоги до результату')]),
        zone('requirements'),
        heading(2, [text('4. Параметри')]),
        {
          type: 'table',
          content: [
            row('Бали за виконання', 'points'),
            row('Кількість виконавців', 'maxAssignees'),
            row('Термін виконання', 'dueDate'),
            row('Обладнання', 'place'),
            row('Виконавці', 'assignees'),
            row('Розподіл балів', 'pointsSplit'),
            row('Дата приймання', 'acceptedAt'),
          ],
        },
        heading(2, [text('5. Критерії приймання')]),
        zone('criteria'),
        {
          type: 'signatures',
          attrs: {
            leftLabel: 'Завдання видав',
            leftSigner: '@author',
            rightLabel: 'Роботу прийняв',
            rightSigner: 'acceptedBy',
          },
        },
      ],
    },
  },
  {
    id: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a31',
    versionId: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a32',
    title: 'Коротке ТЗ',
    fields: [
      field('title', 'Назва', 'text', 'title', true),
      field('points', 'Бали', 'int', 'points', true),
      field('maxAssignees', 'Кількість виконавців', 'int', 'maxAssignees'),
      field('dueDate', 'Термін', 'datetime', 'dueDate'),
      field('goal', 'Мета', 'richtext', 'description'),
      auto('assignees', 'Виконавці', 'list<ref:user>', 'assignees'),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        title(),
        line('Назва', 'title'),
        line('Бали', 'points'),
        line('Кількість виконавців', 'maxAssignees'),
        line('Термін', 'dueDate'),
        line('Виконавці', 'assignees'),
        heading(2, [text('Мета')]),
        zone('goal'),
        {
          type: 'signatures',
          attrs: {
            leftLabel: 'Завдання видав',
            leftSigner: '@author',
            rightLabel: '',
            rightSigner: null,
          },
        },
      ],
    },
  },
];

const IDS = TASK_TEMPLATES.map((t) => t.id);

export class TaskTemplates1812000000000 implements MigrationInterface {
  name = 'TaskTemplates1812000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of TASK_TEMPLATES) {
      // Kept by a revert (documents were made from it): stays as it is.
      const kept = (await q.query(
        `SELECT 1 FROM "paper_templates" WHERE "id" = $1`,
        [t.id],
      )) as unknown[];
      if (kept.length) continue;
      await q.query(
        `INSERT INTO "paper_templates" ("id", "title", "kind", "target", "number_prefix", "auto_freeze", "creators", "visibility", "created_by_id")
         VALUES ($1, $2, 'creates', 'task', 'ТЗ', true, 'staff', 'members', $3)`,
        [t.id, t.title, admin.id],
      );
      await q.query(
        `INSERT INTO "paper_template_versions" ("id", "template_id", "number", "body", "fields", "published_at", "published_by_id")
         VALUES ($1, $2, 1, $3, $4, now(), $5)`,
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

  /** Takes away only the templates no document was made from. */
  public async down(q: QueryRunner): Promise<void> {
    const unused = `"id" = ANY($1) AND NOT EXISTS (
      SELECT 1 FROM "papers" p JOIN "paper_template_versions" v ON v."id" = p."template_version_id"
       WHERE v."template_id" = "paper_templates"."id")`;
    await q.query(
      `UPDATE "paper_templates" SET "current_version_id" = NULL WHERE ${unused}`,
      [IDS],
    );
    await q.query(`DELETE FROM "paper_templates" WHERE ${unused}`, [IDS]);
  }
}
