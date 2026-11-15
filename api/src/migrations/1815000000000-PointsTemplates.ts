import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 3.3б: manual awards are made only through documents, so every
 * installation gets «Відомість балів»: a row — an award (who, how many
 * points, what for); prefix `ВБ`, made by staff, seen by its author, staff
 * and the members it awards; frozen by itself. Published as version 1. The
 * author is the first active admin; without one (an empty database) nothing
 * is created. Only a new row; a template a revert kept (documents were made
 * from it) is left as it is.
 *
 * The body and fields are written out here, as they were on this day (a
 * migration never changes); `points-templates.spec.ts` checks them with the
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
export type PointsTemplate = {
  id: string;
  versionId: string;
  title: string;
  kind: 'creates';
  target: 'points_entry';
  numberPrefix: string;
  autoFreeze: boolean;
  creators: 'staff';
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
const paragraph = (content: Node[], align: string | null = null): Node => ({
  type: 'paragraph',
  attrs: { align },
  content,
});
const th = (label: string): Node => ({
  type: 'tableHeader',
  content: [paragraph([text(label)])],
});
const td = (node: Node): Node => ({
  type: 'tableCell',
  content: [paragraph([node])],
});

export const POINTS_TEMPLATES: PointsTemplate[] = [
  {
    id: 'bfcd968a-9ad7-4ee4-bd2e-32620bad1887',
    versionId: 'f37e97a2-7ad7-414b-b499-8d3a8c3d5f73',
    title: 'Відомість балів',
    kind: 'creates',
    target: 'points_entry',
    numberPrefix: 'ВБ',
    autoFreeze: true,
    creators: 'staff',
    fields: [
      field('awards', 'Нарахування', 'rows', null),
      field('member', 'Учасник', 'ref:user', 'userId'),
      field('amount', 'Бали', 'int', 'amount'),
      field('reason', 'За що', 'text', 'reason'),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        {
          type: 'heading',
          attrs: { level: 1, align: 'center' },
          content: [text('ВІДОМІСТЬ '), { type: 'paperNumber' }],
        },
        paragraph([text('нарахування балів')], 'center'),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        {
          type: 'repeat',
          attrs: { key: 'awards' },
          content: [
            {
              type: 'table',
              content: [
                {
                  type: 'tableRow',
                  content: [th('№'), th('Учасник'), th('Бали'), th('За що')],
                },
                {
                  type: 'tableRow',
                  content: [
                    td({ type: 'rowNumber' }),
                    td({ type: 'field', attrs: { key: 'member' } }),
                    td({ type: 'field', attrs: { key: 'amount' } }),
                    td({ type: 'field', attrs: { key: 'reason' } }),
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'signatures',
          attrs: {
            leftLabel: 'Склав',
            leftSigner: '@author',
            rightLabel: '',
            rightSigner: null,
          },
        },
      ],
    },
  },
];

const IDS = POINTS_TEMPLATES.map((t) => t.id);

export class PointsTemplates1815000000000 implements MigrationInterface {
  name = 'PointsTemplates1815000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of POINTS_TEMPLATES) {
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

  /** Takes away only the template no document was made from. */
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
