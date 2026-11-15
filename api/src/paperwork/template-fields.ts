import type { FieldSchema, FieldType } from '../records/field-types';
import {
  isPlainZone,
  refType,
  signerField,
  walkNodes,
  type PaperContent,
  type PaperNode,
} from './content';
import type { PublishedSchema } from '../records/records.registry';
import { TemplateKind } from './template.entities';

/** Who fills a field: the author of the document, or staff (acceptance…). */
export const FIELD_FILLERS = ['author', 'staff'] as const;
export type FieldFiller = (typeof FIELD_FILLERS)[number];

/** A field of a template version, as stored in its `fields` jsonb. */
export type TemplateField = {
  /** Latin; values of documents are kept under it. Unique in the version. */
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  fill: FieldFiller;
  /** May be changed after the document is published. */
  editable: boolean;
  /** Shown in the print. */
  print: boolean;
  /** Key of a field of the target's schema; null — not bound. */
  binding: string | null;
  /** int, decimal: inclusive bounds. */
  min: number | null;
  max: number | null;
  /** text, richtext, list<text>: the longest value (of each item). */
  maxLength: number | null;
  /** list<…>: at most this many items. */
  maxItems: number | null;
  /** enum, list<enum> not bound: the dictionary of its values. */
  dictionary: string | null;
};

export const TEMPLATE_LIMITS = {
  fields: 200,
  bound: 1e9,
  textMax: 20_000,
  itemsMax: 100,
} as const;

/**
 * What is wrong with a version's fields: `field` — key of the template
 * field to fix; `binding` — key of a schema field that must be bound
 * (a record cannot be created without it).
 */
export type FieldProblem = { field: string } | { binding: string };

const NUMERIC = new Set<FieldType>(['int', 'decimal']);
const TEXT = new Set<FieldType>(['text', 'richtext', 'list<text>']);
const ENUM = new Set<FieldType>(['enum', 'list<enum>']);
const isList = (t: FieldType) => t.startsWith('list<');

/** The first repeated key, if any. */
export function duplicateKey(fields: TemplateField[]): string | null {
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) return f.key;
    seen.add(f.key);
  }
  return null;
}

/** What exists outside the template: dictionaries, record types that may be referred to. */
export type Known = {
  dictionaries: ReadonlySet<string>;
  /** Types registered in the links (LinkRegistry): a picker finds them. */
  refTypes: ReadonlySet<string>;
};

/**
 * Limits suit the type; a free enum has a dictionary that exists; a
 * reference — to a type that may be referred to.
 */
function ownOk(f: TemplateField, { dictionaries, refTypes }: Known) {
  const ref = refType(f.type);
  if (ref !== null && !refTypes.has(ref)) return false;
  const numeric = NUMERIC.has(f.type);
  if (!numeric && (f.min !== null || f.max !== null)) return false;
  if (
    f.type === 'int' &&
    [f.min, f.max].some((v) => v !== null && !Number.isInteger(v))
  ) {
    return false;
  }
  if (f.min !== null && f.max !== null && f.min > f.max) return false;
  if (!TEXT.has(f.type) && f.maxLength !== null) return false;
  if (!isList(f.type) && f.maxItems !== null) return false;
  if (!ENUM.has(f.type)) return f.dictionary === null;
  // A bound enum takes its values from the record's field.
  if (f.binding !== null) return f.dictionary === null;
  return f.dictionary !== null && dictionaries.has(f.dictionary);
}

/** Never wider than the field of the record. */
function narrower(f: TemplateField, s: FieldSchema) {
  const lo = Math.max(f.min ?? -Infinity, s.min ?? -Infinity);
  const hi = Math.min(f.max ?? Infinity, s.max ?? Infinity);
  return (
    lo <= hi &&
    (f.min === null || s.min === undefined || f.min >= s.min) &&
    (f.max === null || s.max === undefined || f.max <= s.max) &&
    (f.maxLength === null ||
      s.maxLength === undefined ||
      f.maxLength <= s.maxLength) &&
    (f.maxItems === null ||
      s.maxItems === undefined ||
      f.maxItems <= s.maxItems)
  );
}

/** Fields of the schema a template of this kind may bind to. */
export function bindable(kind: TemplateKind, schema: PublishedSchema) {
  return schema.fields.filter(
    (s) => !s.archived && (kind === TemplateKind.Report || s.create),
  );
}

/**
 * Bindings against the target's schema: each to a field it may bind to,
 * once, of the same type (a free text zone may bind to a text field: it
 * then takes plain paragraphs), never wider. A template that creates a
 * record binds every field the record needs, as a required field.
 */
export function bindingProblem(
  fields: TemplateField[],
  kind: TemplateKind,
  schema: PublishedSchema | null,
): FieldProblem | null {
  const allowed = new Map(
    schema && kind !== TemplateKind.Free
      ? bindable(kind, schema).map((s) => [s.key, s])
      : [],
  );
  const bound = new Set<string>();
  for (const f of fields) {
    if (f.binding === null) continue;
    const s = allowed.get(f.binding);
    if (
      !s ||
      bound.has(f.binding) ||
      !(f.type === s.type || (f.type === 'richtext' && s.type === 'text')) ||
      !narrower(f, s) ||
      (kind === TemplateKind.Creates && s.required && !f.required)
    ) {
      return { field: f.key };
    }
    bound.add(f.binding);
  }
  if (kind === TemplateKind.Creates) {
    for (const s of allowed.values()) {
      if (s.required && !bound.has(s.key)) return { binding: s.key };
    }
  }
  return null;
}

/** The whole check before a version is published. */
export function fieldsProblem(
  fields: TemplateField[],
  kind: TemplateKind,
  schema: PublishedSchema | null,
  known: Known,
): FieldProblem | null {
  const dup = duplicateKey(fields);
  if (dup) return { field: dup };
  const bad = fields.find((f) => !ownOk(f, known));
  if (bad) return { field: bad.key };
  return bindingProblem(fields, kind, schema);
}

/** Dictionaries the fields take values from. */
export function fieldDictionaries(fields: TemplateField[]): string[] {
  return [
    ...new Set(fields.flatMap((f) => (f.dictionary ? [f.dictionary] : []))),
  ];
}

/**
 * The body and the fields agree: every field is in the body; a free zone
 * (`richtext`) — once, as a zone, the rest — as inline fields (any number
 * of times; a `ref:user` field may stand only as who signs a column of
 * signatures); no unknown keys; nothing of a field inside a zone; a zone
 * bound to a text field starts as plain paragraphs.
 */
export function bodyProblem(
  body: PaperContent,
  fields: TemplateField[],
): FieldProblem | null {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const seen = new Set<string>();
  let problem = null as FieldProblem | null;
  walkNodes(body, (n: PaperNode, insideZone) => {
    if (problem) return;
    if (n.type === 'signatures') {
      // A column signed by a member of a `ref:user` field: the field is on the sheet.
      for (const side of ['leftSigner', 'rightSigner']) {
        const key = signerField(n.attrs?.[side]);
        if (key === null) continue;
        if (byKey.get(key)?.type !== 'ref:user') problem = { field: key };
        else seen.add(key);
      }
      return;
    }
    if (n.type !== 'field' && n.type !== 'fieldZone') return;
    const key = n.attrs?.key as string;
    const f = byKey.get(key);
    const zone = n.type === 'fieldZone';
    if (
      !f ||
      insideZone ||
      zone !== (f.type === 'richtext') ||
      (zone && seen.has(key)) ||
      (zone && f.binding !== null && !isPlainZone(n))
    ) {
      problem = { field: key };
      return;
    }
    seen.add(key);
  });
  if (problem) return problem;
  const missing = fields.find((f) => !seen.has(f.key));
  return missing ? { field: missing.key } : null;
}
