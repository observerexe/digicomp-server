import type { FieldSchema, FieldType } from '../records/field-types';
import {
  conditionFits,
  conditionKind,
  conditionOf,
  isPlainZone,
  refType,
  repeatParts,
  ROWS,
  rowsOf,
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

/**
 * Types of template fields: those of records, and «Повторювані рядки»
 * (`rows`: its value — rows of its columns).
 */
export type TemplateFieldType = FieldType | typeof ROWS;

/** A field of a template version, as stored in its `fields` jsonb. */
export type TemplateField = {
  /** Latin; values of documents are kept under it. Unique in the version. */
  key: string;
  label: string;
  type: TemplateFieldType;
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
  /** list<…>: at most this many items; rows — rows. */
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

const NUMERIC = new Set<TemplateFieldType>(['int', 'decimal']);
const TEXT = new Set<TemplateFieldType>(['text', 'richtext', 'list<text>']);
const ENUM = new Set<TemplateFieldType>(['enum', 'list<enum>']);
const isList = (t: TemplateFieldType) => t.startsWith('list<') || t === ROWS;

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
  // Rows are the template's own: never bound to a record.
  if (f.type === ROWS && f.binding !== null) return false;
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

/** Fields of the schema a template of this kind may bind to: any not archived. */
export function bindable(schema: PublishedSchema) {
  return schema.fields.filter((s) => !s.archived);
}

/**
 * A field nobody fills — it shows the record: in a `creates` template, one
 * bound to what the record gets after creation (assignees, acceptance…),
 * shown once the document is published; in a report, every bound field,
 * shown as soon as the record is chosen.
 */
export function isAutoBinding(kind: TemplateKind, s: FieldSchema) {
  return (
    kind === TemplateKind.Report || (kind === TemplateKind.Creates && !s.create)
  );
}

/**
 * The field a report takes its record from: its first field referring to
 * the target's type that is not bound and not a column of rows; null —
 * none (see reportProblem).
 */
export function reportRecordKey(
  fields: readonly { key: string; type: string; binding: string | null }[],
  target: string,
  columns: ReadonlyMap<string, string> = new Map(),
): string | null {
  const f = fields.find(
    (x) =>
      x.type === `ref:${target}` && x.binding === null && !columns.has(x.key),
  );
  return f ? f.key : null;
}

/**
 * A report names its record in a field (see reportRecordKey): required,
 * never changed after publication, outside conditional blocks. `missing` —
 * there is no such field.
 */
export function reportProblem(
  body: PaperContent,
  fields: TemplateField[],
  kind: TemplateKind,
  target: string | null,
): FieldProblem | 'missing' | null {
  if (kind !== TemplateKind.Report || target === null) return null;
  const key = reportRecordKey(fields, target, rowColumns(body));
  if (key === null) return 'missing';
  const f = fields.find((x) => x.key === key)!;
  const conditional = (body.content ?? []).some(
    (n) => conditionOf(n) !== null && keysIn(n).has(key),
  );
  return !f.required || f.editable || conditional ? { field: key } : null;
}

/**
 * Columns of «Повторювані рядки» in a body: the key of their rows field by
 * the column's key.
 */
export function rowColumns(body: PaperContent): Map<string, string> {
  const out = new Map<string, string>();
  for (const [rows, keys] of rowsOf(body)) {
    for (const key of keys) out.set(key, rows);
  }
  return out;
}

/**
 * Bindings against the target's schema: each to a field it may bind to,
 * once, of the same type (a free text zone may bind to a text field: it
 * then takes plain paragraphs), never wider. A template that creates a
 * record binds every field the record needs, as a required field; a field
 * bound to what the record gets later (see isAutoBinding) is neither
 * required nor changeable.
 *
 * «Рядок = запис»: a template that creates records may bind the columns of
 * one «Повторювані рядки» (`columns` — see rowColumns) — each row not empty
 * then makes a record. Such a template binds nothing else, nothing auto;
 * its rows are required and never change after publication.
 */
export function bindingProblem(
  fields: TemplateField[],
  kind: TemplateKind,
  schema: PublishedSchema | null,
  columns: ReadonlyMap<string, string> = new Map(),
): FieldProblem | null {
  const allowed = new Map(
    schema && kind !== TemplateKind.Free
      ? bindable(schema).map((s) => [s.key, s])
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
      (kind === TemplateKind.Creates && s.required && !f.required) ||
      (isAutoBinding(kind, s) && (f.required || f.editable)) ||
      (columns.has(f.key) &&
        (kind !== TemplateKind.Creates || isAutoBinding(kind, s)))
    ) {
      return { field: f.key };
    }
    bound.add(f.binding);
  }
  const rows = recordRowsKey(fields, columns);
  if (rows !== null) {
    const other = fields.find(
      (f) => f.binding !== null && columns.get(f.key) !== rows,
    );
    if (other) return { field: other.key };
    const own = fields.find((f) => f.key === rows);
    if (!own?.required || own.editable) return { field: rows };
  }
  if (kind === TemplateKind.Creates) {
    for (const s of allowed.values()) {
      if (s.required && !bound.has(s.key)) return { binding: s.key };
    }
  }
  return null;
}

/**
 * «Рядок = запис»: the rows field whose columns are bound to the record
 * (the first bound column's); null — the template binds no column.
 */
export function recordRowsKey(
  fields: readonly { key: string; binding: string | null }[],
  columns: ReadonlyMap<string, string>,
): string | null {
  const f = fields.find((x) => x.binding !== null && columns.has(x.key));
  return f ? columns.get(f.key)! : null;
}

/** The whole check before a version is published (`columns` — see rowColumns). */
export function fieldsProblem(
  fields: TemplateField[],
  kind: TemplateKind,
  schema: PublishedSchema | null,
  known: Known,
  columns: ReadonlyMap<string, string> = new Map(),
): FieldProblem | null {
  const dup = duplicateKey(fields);
  if (dup) return { field: dup };
  const bad = fields.find((f) => !ownOk(f, known));
  if (bad) return { field: bad.key };
  return bindingProblem(fields, kind, schema, columns);
}

/** Dictionaries the fields take values from. */
export function fieldDictionaries(fields: TemplateField[]): string[] {
  return [
    ...new Set(fields.flatMap((f) => (f.dictionary ? [f.dictionary] : []))),
  ];
}

/**
 * The body and the fields agree: every field is in the body; a free zone
 * (`richtext`) — once, as a zone; rows — once, as «Повторювані рядки»; the
 * rest — as inline fields (any number of times; a `ref:user` field may stand
 * only as who signs a column of signatures, any field — only as what an auto
 * table takes); no unknown keys; nothing of a field inside a zone; a zone
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
    if (n.type === 'autoTable') {
      // The field a table takes its rows for is on the sheet (see tableProblem).
      seen.add(n.attrs?.field as string);
      return;
    }
    if (n.type === 'repeat') {
      const key = n.attrs?.key as string;
      if (byKey.get(key)?.type !== ROWS || seen.has(key)) {
        problem = { field: key };
      } else seen.add(key);
      return;
    }
    if (n.type !== 'field' && n.type !== 'fieldZone') return;
    const key = n.attrs?.key as string;
    const f = byKey.get(key);
    const zone = n.type === 'fieldZone';
    if (
      !f ||
      f.type === ROWS ||
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
  if (missing) return { field: missing.key };
  return conditionalProblem(body, byKey) ?? repeatProblem(body, byKey);
}

/**
 * «Авто-таблиця»: of a source that exists (`inputs` — the type of field each
 * takes, see PaperTableRegistry), for a field of that type that holds a
 * value once published (required, or bound to the record), outside
 * conditional blocks and not a column of rows.
 */
export function tableProblem(
  body: PaperContent,
  fields: TemplateField[],
  inputs: ReadonlyMap<string, string>,
): FieldProblem | null {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const columns = rowColumns(body);
  const top = body.content ?? [];
  const conditional = new Set(
    top.filter((n) => conditionOf(n) !== null).flatMap((n) => [...keysIn(n)]),
  );
  for (const n of top) {
    if (n.type !== 'autoTable') continue;
    const key = n.attrs?.field as string;
    const f = byKey.get(key);
    const input = inputs.get(n.attrs?.source as string);
    if (
      !f ||
      input === undefined ||
      f.type !== input ||
      !(f.required || f.binding !== null) ||
      columns.has(key) ||
      conditional.has(key)
    ) {
      return { field: key };
    }
  }
  return null;
}

/**
 * «Повторювані рядки»: a single table with the row that repeats; its header
 * holds no fields and no «№ рядка», no zones anywhere in it. Its columns —
 * fields of that row — are its own: of a type a cell holds (not a zone, not
 * rows), nowhere else on the sheet (not who signs, not what a conditional
 * block waits for). Bound columns — see bindingProblem.
 */
function repeatProblem(
  body: PaperContent,
  byKey: Map<string, TemplateField>,
): FieldProblem | null {
  const columns = new Map<string, string>();
  const elsewhere = new Set<string>();
  for (const n of body.content ?? []) {
    if (n.type !== 'repeat') {
      for (const key of keysIn(n)) elsewhere.add(key);
      const c = conditionOf(n);
      if (c) elsewhere.add(c.field);
      walkNodes(n, (x) => {
        if (x.type !== 'signatures') return;
        for (const side of ['leftSigner', 'rightSigner']) {
          const key = signerField(x.attrs?.[side]);
          if (key !== null) elsewhere.add(key);
        }
      });
      continue;
    }
    const own = n.attrs?.key as string;
    const { table, header, row } = repeatParts(n);
    if (!table || (n.content ?? []).length !== 1 || !row) return { field: own };
    let bad = false;
    for (const h of header) {
      walkNodes(h, (x) => {
        if (['field', 'fieldZone', 'rowNumber'].includes(x.type)) bad = true;
      });
    }
    walkNodes(row, (x) => {
      if (x.type === 'fieldZone') bad = true;
    });
    if (bad) return { field: own };
    for (const key of keysIn(row)) {
      const f = byKey.get(key);
      if (
        !f ||
        f.type === ROWS ||
        f.type === 'richtext' ||
        (columns.get(key) ?? own) !== own
      ) {
        return { field: key };
      }
      columns.set(key, own);
    }
  }
  const shared = [...columns.keys()].find((key) => elsewhere.has(key));
  return shared === undefined ? null : { field: shared };
}

/** Keys of fields and zones in a node (the node itself included). */
function keysIn(n: PaperNode): Set<string> {
  const keys = new Set<string>();
  walkNodes(n, (x) => {
    if (x.type === 'field' || x.type === 'fieldZone') {
      keys.add(x.attrs?.key as string);
    }
  });
  return keys;
}

/**
 * Conditional blocks: each waits for a single field that may be a condition
 * (conditionKind: not a zone, not rows) and stands outside every conditional
 * block; a field of a conditional block is in that block only (it is off or
 * on with it). What it waits for — see conditionProblem (it needs the
 * field's choices).
 */
function conditionalProblem(
  body: PaperContent,
  byKey: Map<string, TemplateField>,
): FieldProblem | null {
  const blockOf = new Map<string, number>();
  const outside = new Set<string>();
  const conditions: string[] = [];
  const top = body.content ?? [];
  for (let i = 0; i < top.length; i++) {
    const n = top[i]!;
    const c = conditionOf(n);
    if (n.type === 'conditional') {
      const f = c ? byKey.get(c.field) : undefined;
      if (!c || !f || conditionKind(f.type) === null) {
        return { field: c?.field ?? String(n.attrs?.field) };
      }
      conditions.push(c.field);
    }
    for (const key of keysIn(n)) {
      if (c) {
        if (outside.has(key) || (blockOf.get(key) ?? i) !== i) {
          return { field: key };
        }
        blockOf.set(key, i);
      } else {
        if (blockOf.has(key)) return { field: key };
        outside.add(key);
      }
    }
  }
  const inner = conditions.find((key) => blockOf.has(key));
  return inner === undefined ? null : { field: inner };
}

/**
 * What a conditional block waits for, against the fields as documents fill
 * them: a value that fits the field's type (conditionFits; a choice —
 * archived ones too: it may be set already), a field people fill (not
 * auto); a field of the block is not bound to what the record cannot be
 * made without (it is empty while the block is off).
 */
export function conditionProblem(
  body: PaperContent,
  fields: {
    key: string;
    type: string;
    auto: boolean;
    binding: string | null;
    options: { key: string }[] | null;
  }[],
  schema: PublishedSchema | null,
): FieldProblem | null {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const required = new Set(
    (schema?.fields ?? []).filter((s) => s.required).map((s) => s.key),
  );
  for (const n of body.content ?? []) {
    const c = conditionOf(n);
    if (!c) continue;
    const f = byKey.get(c.field);
    if (
      !f ||
      f.auto ||
      !conditionFits(
        f.type,
        c.value,
        (f.options ?? []).map((o) => o.key),
      )
    ) {
      return { field: c.field };
    }
    for (const key of keysIn(n)) {
      const binding = byKey.get(key)?.binding;
      if (binding && required.has(binding)) return { field: key };
    }
  }
  return null;
}
