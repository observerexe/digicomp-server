import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 5.4: every installation gets three templates.
 * - «Паспорт проєкту» (`ПП`): a report about a project — its fields, its
 *   goal (written by the author) and its tasks; frozen again whenever
 *   needed (each freeze — a version).
 * - «Підсумковий звіт» (`ЗП`; `ПЗ` — «Протокол зборів»): a report about a project — what it achieved,
 *   its tasks, the stock it used, its sources and conclusions.
 * - «Акт списання» (`АС`): a row — a write-off of stock (the item, how
 *   much, why); publishing takes the stock down, cancelling returns it;
 *   frozen at once.
 * All are made by staff and seen by everyone. Published as version 1. The
 * author is the first active admin; without one (an empty database)
 * nothing is created. Only new rows; a template a revert kept (documents
 * were made from it) is left as it is.
 *
 * The bodies and fields are written out here, as they were on this day (a
 * migration never changes); `project-inventory-templates.spec.ts` checks
 * them with the same rules a published version must keep.
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
  editable: false;
  print: true;
  binding: string | null;
  min: null;
  max: null;
  maxLength: null;
  maxItems: null;
  dictionary: null;
};
export type ProjectInventoryTemplate = {
  id: string;
  versionId: string;
  title: string;
  kind: 'report' | 'creates';
  target: 'project' | 'inventory_writeoff';
  numberPrefix: string;
  autoFreeze: boolean;
  creators: 'staff';
  visibility: 'members';
  body: Node;
  fields: Field[];
};

/**
 * Filled by the author, or (in a report) showing the record: bound — never
 * required; `required` — for fields the author fills.
 */
const field = (
  key: string,
  label: string,
  type: string,
  binding: string | null = null,
  required = binding === null,
): Field => ({
  key,
  label,
  type,
  required,
  fill: 'author',
  editable: false,
  print: true,
  binding,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  dictionary: null,
});

const text = (t: string): Node => ({ type: 'text', text: t });
const value = (key: string): Node => ({ type: 'field', attrs: { key } });
const paragraph = (content: Node[], align: string | null = null): Node => ({
  type: 'paragraph',
  attrs: { align },
  content,
});
const heading = (
  content: Node[],
  level = 1,
  align: string | null = 'center',
): Node => ({ type: 'heading', attrs: { level, align }, content });
const zone = (key: string): Node => ({
  type: 'fieldZone',
  attrs: { key },
  content: [{ type: 'paragraph' }],
});
const autoTable = (source: string, key: string): Node => ({
  type: 'autoTable',
  attrs: { source, field: key },
});
/** A table of two columns: what — its value. */
const facts = (rows: [string, string][]): Node => ({
  type: 'table',
  content: rows.map(([label, key]) => ({
    type: 'tableRow',
    content: [
      { type: 'tableHeader', content: [paragraph([text(label)])] },
      { type: 'tableCell', content: [paragraph([value(key)])] },
    ],
  })),
});
const th = (label: string): Node => ({
  type: 'tableHeader',
  content: [paragraph([text(label)])],
});
const td = (node: Node): Node => ({
  type: 'tableCell',
  content: [paragraph([node])],
});
const signatures = (rightLabel = '', rightSigner: string | null = null) => ({
  type: 'signatures',
  attrs: { leftLabel: 'Склав', leftSigner: '@author', rightLabel, rightSigner },
});

/** The fields of a project both reports show. */
const PROJECT_FIELDS = [
  field('project', 'Проєкт', 'ref:project'),
  field('stage', 'Етап', 'enum', 'stage'),
  field('startDate', 'Початок', 'date', 'startDate'),
  field('deadline', 'Термін', 'date', 'deadline'),
  field('progress', 'Прогрес, %', 'int', 'progress'),
  field('members', 'Учасники', 'list<ref:user>', 'memberIds'),
];

export const PROJECT_INVENTORY_TEMPLATES: ProjectInventoryTemplate[] = [
  {
    id: '7027063b-8e70-4465-a003-038ccdc0e461',
    versionId: '42c44e8f-feac-4307-86b3-a7d7938c2133',
    title: 'Паспорт проєкту',
    kind: 'report',
    target: 'project',
    numberPrefix: 'ПП',
    autoFreeze: false,
    creators: 'staff',
    visibility: 'members',
    fields: [
      ...PROJECT_FIELDS,
      field('title', 'Назва', 'text', 'title'),
      field('author', 'Створив', 'ref:user', 'createdById'),
      field('description', 'Опис', 'text', 'description'),
      field('goal', 'Мета й очікувані результати', 'richtext', null, false),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading([text('ПАСПОРТ ПРОЄКТУ '), { type: 'paperNumber' }]),
        paragraph([value('project')], 'center'),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        heading([text('1. Загальні відомості')], 2, null),
        facts([
          ['Назва', 'title'],
          ['Етап', 'stage'],
          ['Початок', 'startDate'],
          ['Термін', 'deadline'],
          ['Прогрес, %', 'progress'],
          ['Учасники', 'members'],
          ['Створив', 'author'],
        ]),
        heading([text('2. Опис')], 2, null),
        paragraph([value('description')]),
        heading([text('3. Мета й очікувані результати')], 2, null),
        zone('goal'),
        heading([text('4. ТЗ проєкту')], 2, null),
        autoTable('project_tasks', 'project'),
        signatures('Погоджено', '@signer'),
      ],
    },
  },
  {
    id: '9b3920f6-4ce5-47cb-b3dc-ac45c823e49a',
    versionId: 'c35ee000-f7c7-47ff-94d9-6b83afd910ea',
    title: 'Підсумковий звіт',
    kind: 'report',
    target: 'project',
    numberPrefix: 'ЗП',
    autoFreeze: false,
    creators: 'staff',
    visibility: 'members',
    fields: [
      ...PROJECT_FIELDS,
      field('accomplishments', 'Досягнення', 'text', 'accomplishments'),
      field('sources', 'Джерела', 'list<text>', 'sources'),
      field('conclusion', 'Висновки', 'richtext', null, false),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading([text('ПІДСУМКОВИЙ ЗВІТ '), { type: 'paperNumber' }]),
        paragraph([text('про виконання проєкту '), value('project')], 'center'),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        heading([text('1. Загальні відомості')], 2, null),
        facts([
          ['Етап', 'stage'],
          ['Початок', 'startDate'],
          ['Термін', 'deadline'],
          ['Прогрес, %', 'progress'],
          ['Учасники', 'members'],
        ]),
        heading([text('2. Досягнення')], 2, null),
        paragraph([value('accomplishments')]),
        heading([text('3. ТЗ проєкту')], 2, null),
        autoTable('project_tasks', 'project'),
        heading([text('4. Використані матеріали')], 2, null),
        autoTable('project_materials', 'project'),
        heading([text('5. Джерела')], 2, null),
        paragraph([value('sources')]),
        heading([text('6. Висновки')], 2, null),
        zone('conclusion'),
        signatures('Погоджено', '@signer'),
      ],
    },
  },
  {
    id: '17466409-3c76-4deb-a42c-df3e2b4decf0',
    versionId: '94a6eed5-1692-494f-a474-1f9447a7a5b8',
    title: 'Акт списання',
    kind: 'creates',
    target: 'inventory_writeoff',
    numberPrefix: 'АС',
    autoFreeze: true,
    creators: 'staff',
    visibility: 'members',
    fields: [
      field('items', 'Списання', 'rows'),
      field('item', 'Позиція', 'ref:inventory_item', 'itemId', true),
      field('quantity', 'Кількість', 'decimal', 'quantity', true),
      field('reason', 'Причина', 'text', 'note', true),
      field('remark', 'Примітка', 'richtext', null, false),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        { type: 'approval' },
        heading([text('АКТ СПИСАННЯ '), { type: 'paperNumber' }]),
        paragraph([text('матеріальних цінностей зі складу')], 'center'),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        {
          type: 'repeat',
          attrs: { key: 'items' },
          content: [
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [
                    th('№'),
                    th('Позиція'),
                    th('Кількість'),
                    th('Причина'),
                  ],
                },
                {
                  type: 'tableRow',
                  content: [
                    td({ type: 'rowNumber' }),
                    td(value('item')),
                    td(value('quantity')),
                    td(value('reason')),
                  ],
                },
              ],
            },
          ],
        },
        heading([text('Примітка')], 2, null),
        zone('remark'),
        signatures(),
      ],
    },
  },
];

const IDS = PROJECT_INVENTORY_TEMPLATES.map((t) => t.id);

export class ProjectInventoryTemplates1823000000000 implements MigrationInterface {
  name = 'ProjectInventoryTemplates1823000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of PROJECT_INVENTORY_TEMPLATES) {
      // Kept by a revert (documents were made from it): stays as it is.
      const kept = (await q.query(
        `SELECT 1 FROM "paper_templates" WHERE "id" = $1`,
        [t.id],
      )) as unknown[];
      if (kept.length) continue;
      await q.query(
        `INSERT INTO "paper_templates" ("id", "title", "kind", "target", "number_prefix", "auto_freeze", "creators", "visibility", "created_by_id")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          t.id,
          t.title,
          t.kind,
          t.target,
          t.numberPrefix,
          t.autoFreeze,
          t.creators,
          t.visibility,
          admin.id,
        ],
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
