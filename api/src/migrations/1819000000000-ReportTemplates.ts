import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editor 4.3б: every installation gets three templates with auto tables.
 * - «Паспорт обладнання» (`ПО`): a report about equipment — its fields,
 *   authorizations, faults and work sessions; made by staff, seen by its
 *   author and staff; frozen again whenever needed (each freeze — a version).
 * - «Акт несправності» (`АН`): a report about a fault; made by staff, seen
 *   by everyone.
 * - «Рейтинг за місяць» (`РМ`): a free document — the ranking for the month
 *   of a day; made by staff, seen by everyone.
 * Published as version 1. The author is the first active admin; without one
 * (an empty database) nothing is created. Only new rows; a template a revert
 * kept (documents were made from it) is left as it is.
 *
 * The bodies and fields are written out here, as they were on this day (a
 * migration never changes); `report-templates.spec.ts` checks them with the
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
  binding: string | null;
  min: null;
  max: null;
  maxLength: null;
  maxItems: null;
  dictionary: null;
};
export type ReportTemplate = {
  id: string;
  versionId: string;
  title: string;
  kind: 'report' | 'free';
  target: 'place' | 'fault' | null;
  numberPrefix: string;
  creators: 'staff';
  visibility: 'author' | 'members';
  body: Node;
  fields: Field[];
};

/** Filled by the author (required), or showing the record (bound: never required). */
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
const signatures = (rightLabel = '', rightSigner: string | null = null) => ({
  type: 'signatures',
  attrs: { leftLabel: 'Склав', leftSigner: '@author', rightLabel, rightSigner },
});

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'bf0309ec-c3b4-4fe3-9ff2-0b75403b7b59',
    versionId: 'd9e6f105-d2da-4383-83e6-0a4e252c533b',
    title: 'Паспорт обладнання',
    kind: 'report',
    target: 'place',
    numberPrefix: 'ПО',
    creators: 'staff',
    visibility: 'author',
    fields: [
      field('place', 'Обладнання', 'ref:place'),
      field('code', 'Код', 'text', 'code'),
      field('title', 'Назва', 'text', 'title'),
      field('category', 'Категорія', 'enum', 'category'),
      field('location', 'Розташування', 'text', 'location'),
      field('description', 'Опис', 'text', 'description'),
      field('status', 'Стан', 'enum', 'status'),
      field(
        'needsAuthorization',
        'Потрібен допуск',
        'bool',
        'needsAuthorization',
      ),
      field('exclusive', 'Лише один сеанс одночасно', 'bool', 'exclusive'),
      field('createdAt', 'Додано', 'datetime', 'createdAt'),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading([text('ПАСПОРТ ОБЛАДНАННЯ '), { type: 'paperNumber' }]),
        paragraph([value('place')], 'center'),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        heading([text('1. Загальні відомості')], 2, null),
        facts([
          ['Код', 'code'],
          ['Назва', 'title'],
          ['Категорія', 'category'],
          ['Розташування', 'location'],
          ['Опис', 'description'],
          ['Стан', 'status'],
          ['Потрібен допуск', 'needsAuthorization'],
          ['Лише один сеанс одночасно', 'exclusive'],
          ['Додано', 'createdAt'],
        ]),
        heading([text('2. Допуски')], 2, null),
        autoTable('place_authorizations', 'place'),
        heading([text('3. Несправності')], 2, null),
        autoTable('place_faults', 'place'),
        heading([text('4. Журнал сеансів')], 2, null),
        autoTable('place_sessions', 'place'),
        signatures(),
      ],
    },
  },
  {
    id: 'd052b3f3-be75-4ba6-9685-01855e596321',
    versionId: 'ac564abe-4476-44b1-980c-12f513670c65',
    title: 'Акт несправності',
    kind: 'report',
    target: 'fault',
    numberPrefix: 'АН',
    creators: 'staff',
    visibility: 'members',
    fields: [
      field('fault', 'Несправність', 'ref:fault'),
      field('place', 'Обладнання', 'ref:place', 'placeId'),
      field('reporter', 'Повідомив', 'ref:user', 'reporterId'),
      field('reportedAt', 'Повідомлено', 'datetime', 'createdAt'),
      field('status', 'Стан', 'enum', 'status'),
      field('description', 'Опис', 'text', 'description'),
      field('resolution', 'Що зроблено', 'text', 'resolution'),
      field('closedBy', 'Закрив', 'ref:user', 'closedById'),
      field('closedAt', 'Закрито', 'datetime', 'closedAt'),
      field('conclusion', 'Висновок', 'richtext', null, false),
    ],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading([text('АКТ НЕСПРАВНОСТІ '), { type: 'paperNumber' }]),
        paragraph([text('Дата складання: '), { type: 'paperDate' }]),
        paragraph([text('Підстава: '), value('fault')]),
        facts([
          ['Обладнання', 'place'],
          ['Повідомив', 'reporter'],
          ['Повідомлено', 'reportedAt'],
          ['Стан', 'status'],
          ['Закрив', 'closedBy'],
          ['Закрито', 'closedAt'],
        ]),
        heading([text('Опис несправності')], 2, null),
        paragraph([value('description')]),
        heading([text('Що зроблено')], 2, null),
        paragraph([value('resolution')]),
        heading([text('Висновок')], 2, null),
        zone('conclusion'),
        signatures('Погоджено', '@signer'),
      ],
    },
  },
  {
    id: 'ae1f2d79-6dd1-41e8-a66d-5100569dd65b',
    versionId: '0bb3bcb8-5f8c-4c81-a05d-b608f11fa395',
    title: 'Рейтинг за місяць',
    kind: 'free',
    target: null,
    numberPrefix: 'РМ',
    creators: 'staff',
    visibility: 'members',
    // Only the table takes it: the sheet shows the month above the table.
    fields: [field('month', 'Місяць (будь-який його день)', 'date')],
    body: {
      type: 'doc',
      content: [
        { type: 'orgHeader' },
        heading([text('РЕЙТИНГ УЧАСНИКІВ '), { type: 'paperNumber' }]),
        paragraph([text('Дата: '), { type: 'paperDate' }]),
        autoTable('points_month', 'month'),
        signatures(),
      ],
    },
  },
];

const IDS = REPORT_TEMPLATES.map((t) => t.id);

export class ReportTemplates1819000000000 implements MigrationInterface {
  name = 'ReportTemplates1819000000000';

  public async up(q: QueryRunner): Promise<void> {
    const [admin] = (await q.query(
      `SELECT "id" FROM "users" WHERE "role" = 'admin' AND "active" ORDER BY "created_at" LIMIT 1`,
    )) as { id: string }[];
    if (!admin) return;
    for (const t of REPORT_TEMPLATES) {
      // Kept by a revert (documents were made from it): stays as it is.
      const kept = (await q.query(
        `SELECT 1 FROM "paper_templates" WHERE "id" = $1`,
        [t.id],
      )) as unknown[];
      if (kept.length) continue;
      await q.query(
        `INSERT INTO "paper_templates" ("id", "title", "kind", "target", "number_prefix", "auto_freeze", "creators", "visibility", "created_by_id")
         VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8)`,
        [
          t.id,
          t.title,
          t.kind,
          t.target,
          t.numberPrefix,
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
