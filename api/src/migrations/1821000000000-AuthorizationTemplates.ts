import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 4.4: допуски are granted only through documents, so every
 * installation gets «Запис про інструктаж і допуск» (grants the допуск, a
 * repeat briefing renews it; prefix `ІД`, made by staff, seen by its author,
 * staff and the member it is about; frozen at once). Published as version 1.
 * The author is the first active admin; without one (an empty database)
 * nothing is created. Only new rows; a template a revert kept (documents
 * were made from it) is left as it is.
 *
 * The body and fields are written out here, as they were on this day (a
 * migration never changes); `authorization-templates.spec.ts` checks them
 * with the same rules a published version must keep.
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
  maxLength: number | null;
  maxItems: null;
  dictionary: null;
};
export type AuthorizationTemplate = {
  id: string;
  versionId: string;
  title: string;
  kind: 'creates';
  target: 'place_authorization';
  numberPrefix: string;
  autoFreeze: true;
  creators: 'staff';
  visibility: 'author';
  body: Node;
  fields: Field[];
};

/** Filled by the author; what it says is final once published. */
const field = (
  key: string,
  label: string,
  type: string,
  binding: string | null,
  required: boolean,
  maxLength: number | null = null,
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
  maxLength,
  maxItems: null,
  dictionary: null,
});

const text = (t: string): Node => ({ type: 'text', text: t });
const paragraph = (content: Node[], align: string | null = null): Node => ({
  type: 'paragraph',
  attrs: { align },
  content,
});
const line = (label: string, key: string): Node =>
  paragraph([text(`${label}: `), { type: 'field', attrs: { key } }]);
const heading = (
  level: number,
  content: Node[],
  align: string | null = null,
): Node => ({ type: 'heading', attrs: { level, align }, content });

export const AUTHORIZATION_TEMPLATES: AuthorizationTemplate[] = [
  {
    id: '2e35d9e3-06d9-4428-adb5-f26a1b877ad4',
    versionId: '1ae3f9a4-5933-4a8d-a593-bc514ef1cfa1',
    title: 'Запис про інструктаж і допуск',
    kind: 'creates',
    target: 'place_authorization',
    numberPrefix: 'ІД',
    autoFreeze: true,
    creators: 'staff',
    visibility: 'author',
    fields: [
      field('userId', 'Учасник', 'ref:user', 'userId', true),
      field('placeId', 'Обладнання', 'ref:place', 'placeId', true),
      field('expiresAt', 'Діє до', 'datetime', 'expiresAt', false),
      field('note', 'Примітка', 'text', 'note', false, 500),
      field('briefing', 'Зміст інструктажу', 'richtext', null, true),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading(1, [text('ЗАПИС '), { type: 'paperNumber' }], 'center'),
        paragraph(
          [text('про інструктаж і допуск до роботи з обладнанням')],
          'center',
        ),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        line('Учасник', 'userId'),
        line('Обладнання', 'placeId'),
        line('Допуск діє до', 'expiresAt'),
        line('Примітка', 'note'),
        heading(2, [text('Зміст інструктажу')]),
        {
          type: 'fieldZone',
          attrs: { key: 'briefing' },
          content: [{ type: 'paragraph' }],
        },
        paragraph([
          text(
            'Інструктаж проведено, учасник його зрозумів і допускається до самостійної роботи з обладнанням.',
          ),
        ]),
        {
          type: 'signatures',
          attrs: {
            leftLabel: 'Інструктаж провів',
            leftSigner: '@author',
            rightLabel: 'Інструктаж отримав',
            rightSigner: 'userId',
          },
        },
      ],
    },
  },
];

const IDS = AUTHORIZATION_TEMPLATES.map((t) => t.id);

export class AuthorizationTemplates1821000000000 implements MigrationInterface {
  name = 'AuthorizationTemplates1821000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of AUTHORIZATION_TEMPLATES) {
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
