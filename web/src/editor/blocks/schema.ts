import type { RecordField, RecordSchema, TemplateKind } from '../../api/types';
import { BLOCK_GROUPS, BLOCKS, fieldBlockOf, type FieldBlock, type Palette } from '.';

/** A text of the record longer than this goes on the sheet as a free zone (paragraphs, no formatting). */
export const LONG_TEXT = 500;

/**
 * A bound field nobody fills — it shows the record: in a `creates` template,
 * one bound to what the record gets later (assignees, acceptance…), shown
 * once published; in a report, every bound field, shown once the record is chosen.
 */
export const isAutoBinding = (kind: TemplateKind, f: RecordField | undefined) => !!f && (kind === 'report' || (kind === 'creates' && !f.create));

/**
 * Fields of the record a template may bind (any not archived; a free
 * template — none): `creates` — those set when the record is created first,
 * then what it gets later (auto fields).
 */
export function bindableFields(kind: TemplateKind, schema: RecordSchema | null | undefined): RecordField[] {
  if (kind === 'free' || !schema) return [];
  const all = schema.fields.filter((f) => !f.archived);
  return [...all.filter((f) => !isAutoBinding(kind, f)), ...all.filter((f) => isAutoBinding(kind, f))];
}

/**
 * «Поля запису «<тип>»»: a block per field of the record, from its schema.
 * The block puts a field already bound: the record's type, name and key; a
 * long text — a free zone.
 */
export function schemaBlocks(kind: TemplateKind, schema: RecordSchema | null | undefined): FieldBlock[] {
  const fields = bindableFields(kind, schema).map((f): FieldBlock => {
    const auto = isAutoBinding(kind, f);
    // What the record gets later is shown in a line, never written.
    const long = !auto && f.type === 'text' && (f.maxLength === undefined || f.maxLength > LONG_TEXT);
    const type = long ? 'richtext' : f.type;
    return {
      key: `schema:${f.key}`,
      group: 'schema',
      kind: 'field',
      label: f.label,
      icon: fieldBlockOf(type)?.icon ?? 'textField',
      type,
      prefix: f.key,
      hint:
        kind === 'report'
          ? `Підставиться із запису «${schema!.label}», про який звіт`
          : auto
            ? `Заповниться із запису «${schema!.label}» після публікації`
            : `Поле запису «${schema!.label}»: значення піде в запис`,
      binding: f.key,
      required: kind === 'creates' && !!f.required,
    };
  });
  if (kind !== 'report' || !schema) return fields;
  // A report names its record in a field of its own: the first of the group.
  const type = `ref:${schema.type}`;
  const record: FieldBlock = {
    key: 'schema:@record',
    group: 'schema',
    kind: 'field',
    label: schema.label,
    icon: fieldBlockOf(type)?.icon ?? 'file',
    type,
    prefix: schema.type,
    hint: `Про який запис звіт: людина вибирає його, решта полів підставиться з нього`,
    required: true,
  };
  return [record, ...fields];
}

/** The palette of a template: its record's fields first (if any), then every block. */
export function paletteOf(kind: TemplateKind, schema: RecordSchema | null | undefined): Palette {
  const own = schemaBlocks(kind, schema);
  if (!own.length) return { groups: BLOCK_GROUPS, blocks: BLOCKS };
  return { groups: [{ key: 'schema', label: `Поля запису «${schema!.label}»` }, ...BLOCK_GROUPS], blocks: [...own, ...BLOCKS] };
}
