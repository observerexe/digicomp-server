import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 3.2: discipline is issued only through documents, so every
 * installation gets «Подання про стягнення» (issues a warning, a fine or a
 * reprimand; prefix `ПС`, made by staff, seen by its author, staff and the
 * member it is about; the fine's size — in a conditional block shown for a
 * fine) and «Пояснювальна записка» (free, made by everyone, refers to the
 * record; seen by its author and staff). Published as version 1. The author
 * is the first active admin; without one (an empty database) nothing is
 * created. Only new rows; a template a revert kept (documents were made
 * from it) is left as it is.
 *
 * Bodies and fields are written out here, as they were on this day (a
 * migration never changes); `discipline-templates.spec.ts` checks them with
 * the same rules a published version must keep.
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
  required: true;
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
export type DisciplineTemplate = {
  id: string;
  versionId: string;
  title: string;
  kind: 'creates' | 'free';
  target: 'discipline_record' | null;
  numberPrefix: string | null;
  autoFreeze: boolean;
  creators: 'staff' | 'all';
  body: Node;
  fields: Field[];
};

/** Required, filled by the author; what it says is final once published. */
const field = (
  key: string,
  label: string,
  type: string,
  binding: string | null,
): Field => ({
  key,
  label,
  type,
  required: true,
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
): Node => ({ type: 'heading', attrs: { level, align }, content });
const zone = (key: string): Node => ({
  type: 'fieldZone',
  attrs: { key },
  content: [{ type: 'paragraph' }],
});
const signedBy = (label: string): Node => ({
  type: 'signatures',
  attrs: {
    leftLabel: label,
    leftSigner: '@author',
    rightLabel: '',
    rightSigner: null,
  },
});

export const DISCIPLINE_TEMPLATES: DisciplineTemplate[] = [
  {
    id: '72f4efa9-34a6-4f76-81e0-0eda90f24d4f',
    versionId: '0ee13fb6-d615-4617-85ed-93cfbc06bc60',
    title: 'Подання про стягнення',
    kind: 'creates',
    target: 'discipline_record',
    numberPrefix: 'ПС',
    autoFreeze: true,
    creators: 'staff',
    fields: [
      field('userId', 'Кому', 'ref:user', 'userId'),
      field('type', 'Вид стягнення', 'enum', 'type'),
      field('amount', 'Розмір штрафу, балів', 'int', 'amount'),
      field('reason', 'Підстава', 'richtext', 'reason'),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading(1, [text('ПОДАННЯ '), { type: 'paperNumber' }], 'center'),
        paragraph([text('про стягнення')], 'center'),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        line('Кому', 'userId'),
        line('Вид стягнення', 'type'),
        {
          type: 'conditional',
          attrs: { field: 'type', value: 'fine' },
          content: [line('Розмір штрафу, балів', 'amount')],
        },
        heading(2, [text('Підстава')]),
        zone('reason'),
        signedBy('Подав'),
      ],
    },
  },
  {
    id: 'ad14fe92-dd38-4547-b906-2067ac6315a4',
    versionId: '8648e730-b218-4aa5-9e82-77c33c44999e',
    title: 'Пояснювальна записка',
    kind: 'free',
    target: null,
    numberPrefix: null,
    autoFreeze: false,
    creators: 'all',
    fields: [
      field('record', 'Стягнення', 'ref:discipline_record', null),
      field('text', 'Пояснення', 'richtext', null),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading(1, [text('ПОЯСНЮВАЛЬНА ЗАПИСКА')], 'center'),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        line('Щодо стягнення', 'record'),
        heading(2, [text('Пояснення')]),
        zone('text'),
        signedBy('Склав'),
      ],
    },
  },
];

const IDS = DISCIPLINE_TEMPLATES.map((t) => t.id);

export class DisciplineTemplates1813000000000 implements MigrationInterface {
  name = 'DisciplineTemplates1813000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of DISCIPLINE_TEMPLATES) {
      // Kept by a revert (documents were made from it): stays as it is.
      const kept = (await q.query(
        `SELECT 1 FROM "paper_templates" WHERE "id" = $1`,
        [t.id],
      )) as unknown[];
      if (kept.length) continue;
      await q.query(
        `INSERT INTO "paper_templates" ("id", "title", "kind", "target", "number_prefix", "auto_freeze", "creators", "visibility", "created_by_id")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'author', $8)`,
        [
          t.id,
          t.title,
          t.kind,
          t.target,
          t.numberPrefix,
          t.autoFreeze,
          t.creators,
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
