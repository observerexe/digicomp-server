import type { RecordField, RecordSchema, TemplateKind } from '../../api/types';
import { BLOCK_GROUPS, BLOCKS, fieldBlockOf, type FieldBlock, type Palette } from '.';

/** A text of the record longer than this goes on the sheet as a free zone (paragraphs, no formatting). */
export const LONG_TEXT = 500;

/**
 * Fields of the record a template may bind: `creates` — those set when the
 * record is created; `report` — any; a free template — none.
 */
export function bindableFields(kind: TemplateKind, schema: RecordSchema | null | undefined): RecordField[] {
  if (kind === 'free' || !schema) return [];
  return schema.fields.filter((f) => !f.archived && (kind === 'report' || f.create));
}

/**
 * «Поля запису «<тип>»»: a block per field of the record, from its schema.
 * The block puts a field already bound: the record's type, name and key; a
 * long text — a free zone.
 */
export function schemaBlocks(kind: TemplateKind, schema: RecordSchema | null | undefined): FieldBlock[] {
  return bindableFields(kind, schema).map((f) => {
    const long = f.type === 'text' && (f.maxLength === undefined || f.maxLength > LONG_TEXT);
    const type = long ? 'richtext' : f.type;
    return {
      key: `schema:${f.key}`,
      group: 'schema',
      kind: 'field',
      label: f.label,
      icon: fieldBlockOf(type)?.icon ?? 'textField',
      type,
      prefix: f.key,
      hint: `Поле запису «${schema!.label}»: значення піде в запис`,
      binding: f.key,
      required: kind === 'creates' && !!f.required,
    };
  });
}

/** The palette of a template: its record's fields first (if any), then every block. */
export function paletteOf(kind: TemplateKind, schema: RecordSchema | null | undefined): Palette {
  const own = schemaBlocks(kind, schema);
  if (!own.length) return { groups: BLOCK_GROUPS, blocks: BLOCKS };
  return { groups: [{ key: 'schema', label: `Поля запису «${schema!.label}»` }, ...BLOCK_GROUPS], blocks: [...own, ...BLOCKS] };
}
