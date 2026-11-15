import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 2.4: the first templates every installation starts with —
 * «Протокол зборів» and «Інструкція з безпеки». Both free (no record), A4,
 * published as version 1; afterwards they are edited in the constructor like
 * any other template. The author is the first active admin; without one
 * (an empty database) nothing is created. Only new rows; a template a revert
 * kept (documents were made from it) is left as it is.
 *
 * Bodies and fields are written out here, as they were on this day (a
 * migration never changes); `starter-templates.spec.ts` checks them with the
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
  editable: false;
  print: true;
  binding: null;
  min: null;
  max: null;
  maxLength: null;
  maxItems: null;
  dictionary: null;
};
export type StarterTemplate = {
  id: string;
  versionId: string;
  title: string;
  numberPrefix: string;
  creators: 'all' | 'staff';
  visibility: 'author' | 'members';
  body: Node;
  fields: Field[];
};

const field = (
  key: string,
  label: string,
  type: string,
  required = false,
): Field => ({
  key,
  label,
  type,
  required,
  fill: 'author',
  editable: false,
  print: true,
  binding: null,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  dictionary: null,
});
const text = (t: string): Node => ({ type: 'text', text: t });
const line = (label: string, key: string): Node => ({
  type: 'paragraph',
  content: [text(`${label}: `), { type: 'field', attrs: { key } }],
});
const heading = (level: number, t: string, align: string | null = null) => ({
  type: 'heading',
  attrs: { level, align },
  content: [text(t)],
});
const zone = (key: string): Node => ({
  type: 'fieldZone',
  attrs: { key },
  content: [{ type: 'paragraph' }],
});

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a01',
    versionId: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a02',
    title: 'Протокол зборів',
    numberPrefix: 'ПЗ',
    creators: 'all',
    visibility: 'members',
    fields: [
      field('date', 'Дата', 'date', true),
      field('venue', 'Місце', 'text'),
      field('chair', 'Головує', 'ref:user', true),
      field('secretary', 'Секретар', 'ref:user'),
      field('present', 'Присутні', 'list<ref:user>'),
      field('agenda', 'Порядок денний', 'richtext', true),
      field('heard', 'Слухали', 'richtext'),
      field('decided', 'Ухвалили', 'richtext', true),
    ],
    body: {
      type: 'doc',
      content: [
        heading(1, 'ПРОТОКОЛ ЗБОРІВ', 'center'),
        line('Дата', 'date'),
        line('Місце', 'venue'),
        line('Головує', 'chair'),
        line('Секретар', 'secretary'),
        line('Присутні', 'present'),
        heading(2, 'Порядок денний'),
        zone('agenda'),
        heading(2, 'Слухали'),
        zone('heard'),
        heading(2, 'Ухвалили'),
        zone('decided'),
      ],
    },
  },
  {
    id: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a11',
    versionId: '6b0b8f3e-2f4c-4a63-9b1e-0d6a3c2e7a12',
    title: 'Інструкція з безпеки',
    numberPrefix: 'ІБ',
    creators: 'staff',
    visibility: 'members',
    fields: [
      field('place', 'Обладнання', 'ref:place', true),
      field('general', 'Загальні вимоги', 'richtext', true),
      field('before', 'Перед початком роботи', 'richtext'),
      field('during', 'Під час роботи', 'richtext'),
      field('after', 'Після закінчення роботи', 'richtext'),
      field('emergency', 'У разі несправності чи аварії', 'richtext'),
    ],
    body: {
      type: 'doc',
      content: [
        heading(1, 'ІНСТРУКЦІЯ З БЕЗПЕКИ', 'center'),
        {
          type: 'paragraph',
          attrs: { align: 'center' },
          content: [
            text('під час роботи з обладнанням '),
            { type: 'field', attrs: { key: 'place' } },
          ],
        },
        heading(2, '1. Загальні вимоги'),
        zone('general'),
        heading(2, '2. Перед початком роботи'),
        zone('before'),
        heading(2, '3. Під час роботи'),
        zone('during'),
        heading(2, '4. Після закінчення роботи'),
        zone('after'),
        heading(2, '5. У разі несправності чи аварії'),
        zone('emergency'),
      ],
    },
  },
];

const IDS = STARTER_TEMPLATES.map((t) => t.id);

export class StarterTemplates1809000000000 implements MigrationInterface {
  name = 'StarterTemplates1809000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of STARTER_TEMPLATES) {
      // Kept by a revert (documents were made from it): stays as it is.
      const kept = (await q.query(
        `SELECT 1 FROM "paper_templates" WHERE "id" = $1`,
        [t.id],
      )) as unknown[];
      if (kept.length) continue;
      await q.query(
        `INSERT INTO "paper_templates" ("id", "title", "kind", "number_prefix", "creators", "visibility", "created_by_id")
         VALUES ($1, $2, 'free', $3, $4, $5, $6)`,
        [t.id, t.title, t.numberPrefix, t.creators, t.visibility, admin.id],
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
