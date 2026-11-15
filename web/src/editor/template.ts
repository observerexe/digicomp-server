import type { Node as PMNode } from '@tiptap/pm/model';
import type { RecordField, RecordSchema, TemplateField, TemplateKind } from '../api/types';
import { FIELD_KEY, signerField } from '../../../shared/editor-schema';
import { itemType, rowsOf, walkNodes } from '../../../shared/editor-schema/fields';
import type { PaperNode } from '../../../shared/editor-schema';
import { plural } from '../lib/format';
import { fieldBlockOf, type FieldBlock } from './blocks';
import { bindableFields } from './blocks/schema';

/**
 * Fields of a template version in the constructor. The sheet (the body) is
 * the source of order: a field is in the version while it is on the sheet.
 * The server checks the sense of fields when the version is published.
 */

/** A field with every property given (the server's optional ones as null). */
export type FieldDef = Required<TemplateField>;
export type FieldType = TemplateField['type'];

export const LABEL_MAX = 100;

export function fromServer(f: TemplateField): FieldDef {
  return {
    ...f,
    binding: f.binding ?? null,
    min: f.min ?? null,
    max: f.max ?? null,
    maxLength: f.maxLength ?? null,
    maxItems: f.maxItems ?? null,
    dictionary: f.dictionary ?? null,
  };
}

/** `prefix<n>`, the smallest n not taken. */
export function newKey(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/**
 * A new field of a block: filled by the author, shown in the print. A field of
 * the record is bound to it and takes its key while that is free.
 */
export function newField(block: FieldBlock, taken: ReadonlySet<string>): FieldDef {
  const own = block.binding !== undefined && !taken.has(block.prefix);
  const key = own ? block.prefix : newKey(block.prefix, taken);
  const n = Number(key.slice(block.prefix.length));
  return {
    key,
    label: n > 1 && !block.binding ? `${block.label} ${n}` : block.label,
    type: block.type as FieldType,
    required: block.required ?? false,
    fill: 'author',
    editable: false,
    print: true,
    binding: block.binding ?? null,
    min: null,
    max: null,
    maxLength: null,
    maxItems: null,
    dictionary: null,
  };
}

/**
 * Settings of the version's fields; a field on the sheet without settings
 * (a body saved apart from its fields) gets those of a line or a zone.
 */
export function defsOf(fields: readonly TemplateField[], body: PaperNode): Map<string, FieldDef> {
  const defs = new Map(fields.map((f) => [f.key, fromServer(f)]));
  walkNodes(body, (n) => {
    if (n.type !== 'field' && n.type !== 'fieldZone' && n.type !== 'repeat') return;
    const key = n.attrs?.key as string;
    const block = fieldBlockOf(n.type === 'fieldZone' ? 'richtext' : n.type === 'repeat' ? 'rows' : 'text');
    if (!defs.has(key) && block) defs.set(key, { ...newField(block, new Set()), key, label: key });
  });
  return defs;
}

/**
 * Keys of fields and zones in the order of the sheet, each once; rows — before
 * their columns; a member who signs a column of signatures is a field too.
 */
export function keysOf(doc: PMNode): string[] {
  const keys = new Set<string>();
  doc.descendants((n) => {
    if (n.type.name === 'field' || n.type.name === 'fieldZone' || n.type.name === 'repeat') keys.add(n.attrs.key as string);
    if (n.type.name === 'signatures') {
      for (const side of ['leftSigner', 'rightSigner']) {
        const key = signerField(n.attrs[side]);
        if (key !== null) keys.add(key);
      }
    }
    return true;
  });
  return [...keys];
}

/** Columns of «Повторювані рядки» on the sheet: the key of their rows field by the column's key. */
export function columnsOf(doc: PMNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const [rows, columns] of rowsOf(doc.toJSON() as PaperNode)) for (const c of columns) out.set(c, rows);
  return out;
}

/** The fields of the version: those on the sheet, in its order. */
export function fieldsOf(defs: ReadonlyMap<string, FieldDef>, keys: readonly string[]): FieldDef[] {
  return keys.flatMap((k) => {
    const f = defs.get(k);
    return f ? [f] : [];
  });
}

export const isNumeric = (t: string) => t === 'int' || t === 'decimal';
export const hasLength = (t: string) => t === 'text' || t === 'richtext' || t === 'list<text>';
export const isList = (t: string) => itemType(t) !== null;
export const isChoice = (t: string) => t === 'enum' || t === 'list<enum>';

/** The field as another type of its block: what does not suit the type goes. */
export function withType(f: FieldDef, type: FieldType): FieldDef {
  return {
    ...f,
    type,
    min: isNumeric(type) ? (type === 'int' && f.min !== null ? Math.ceil(f.min) : f.min) : null,
    max: isNumeric(type) ? (type === 'int' && f.max !== null ? Math.floor(f.max) : f.max) : null,
    maxLength: hasLength(type) ? f.maxLength : null,
    maxItems: isList(type) ? f.maxItems : null,
    dictionary: isChoice(type) ? f.dictionary : null,
    // A binding is to a field of the same type.
    binding: null,
  };
}

/** A key: Latin, from a small letter, not taken by another field. null — fine. */
export function keyProblem(key: string, own: string, taken: ReadonlySet<string>): string | null {
  if (!FIELD_KEY.test(key)) return 'Латиницею, з малої літери, без пробілів: літери, цифри, «_» (до 40).';
  if (key !== own && taken.has(key)) return 'Такий ключ уже є в шаблоні.';
  return null;
}

/**
 * Fields of the record a field may bind to: a field the template may set
 * (`creates` — set when the record is created; `report` — any), of the same
 * type (a free zone — also a text field), not bound by another field.
 */
export function bindingOptions(f: FieldDef, kind: TemplateKind, schema: RecordSchema | null | undefined, fields: readonly FieldDef[]): RecordField[] {
  const taken = new Set(fields.filter((o) => o.key !== f.key && o.binding).map((o) => o.binding));
  return bindableFields(kind, schema).filter((s) => (s.type === f.type || (f.type === 'richtext' && s.type === 'text')) && !taken.has(s.key));
}

const NUM = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2, useGrouping: false });

/** «0–1000», «від 1», «до 200 знаків»; null — no limits. */
export function limitsText(f: Pick<FieldDef, 'min' | 'max' | 'maxLength' | 'maxItems'>): string | null {
  const parts: string[] = [];
  if (f.min !== null && f.max !== null) parts.push(`${NUM.format(f.min)}–${NUM.format(f.max)}`);
  else if (f.min !== null) parts.push(`від ${NUM.format(f.min)}`);
  else if (f.max !== null) parts.push(`до ${NUM.format(f.max)}`);
  if (f.maxLength !== null) parts.push(`до ${f.maxLength} ${plural(f.maxLength, ['знака', 'знаків', 'знаків'])}`);
  if (f.maxItems !== null) parts.push(`до ${f.maxItems} шт.`);
  return parts.length ? parts.join(', ') : null;
}

/** What a field is called by its block («Число»); a type without a block — the type itself. */
export function blockLabel(type: string): string {
  return fieldBlockOf(type)?.label ?? type;
}

/** The label of a field's block on the sheet: «Число · points → Бали · 0–1000 · обов'язкове». */
export function fieldTag(f: FieldDef, schema: RecordSchema | null | undefined): string {
  const bound = f.binding ? (schema?.fields.find((s) => s.key === f.binding)?.label ?? f.binding) : null;
  return [blockLabel(f.type), bound ? `${f.key} → ${bound}` : f.key, limitsText(f), f.required ? 'обов’язкове' : null].filter(Boolean).join(' · ');
}
