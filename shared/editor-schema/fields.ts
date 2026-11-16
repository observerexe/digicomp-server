/**
 * Template fields in a document: what a value of each type may be, how it reads
 * on the sheet and in the print, and how a document keeps to its template's body.
 * The web editor (fieldTypes/) and the API (values check, print) use the same.
 *
 * No package imports (see index.ts).
 */
import { COLORS, CONDITIONAL, FIELD_KEY, MARKS, NODES, RECORD_ID, REPEAT, type PaperAttrs, type PaperMark, type PaperNode } from './index';

/** One value of a field or of an item of a list. */
export type FieldScalar = string | number | boolean;
/** A row of «Повторювані рядки»: values of its columns by their keys (an empty cell — no key). */
export type FieldRow = Record<string, FieldScalar | FieldScalar[]>;
/** A value as kept in the document's `values`: a scalar, a list, or the rows of a `rows` field. */
export type FieldValue = FieldScalar | FieldScalar[] | FieldRow[];
export type FieldValues = Record<string, FieldValue>;

/** The type of «Повторювані рядки»: a template's own, never a field of a record. */
export const ROWS = 'rows';

/** One choice of an `enum` field. Archived — stays where set, not offered. */
export type FieldOption = { key: string; label: string; archived?: boolean };

/** What the check and the text of a value need to know about a field. */
export type FieldSpec = {
  key: string;
  type: string;
  min: number | null;
  max: number | null;
  maxLength: number | null;
  maxItems: number | null;
  /** decimal: digits after the point. */
  scale: number | null;
  /** rows: the fields of its columns. */
  columns?: readonly FieldSpec[] | null;
};

export const FIELD_LIMITS = {
  /** int, decimal: |value|. */
  bound: 1e9,
  /** text without maxLength. */
  textDefault: 1000,
  /** richtext (a zone) without maxLength. */
  zoneDefault: 20_000,
  /** list without maxItems. */
  itemsDefault: 20,
  /** rows without maxItems. */
  rowsDefault: 50,
  scaleDefault: 2,
  /** enum: length of a key. */
  keyMax: 40,
} as const;

/** `list<int>` → `int`; null — not a list. */
export function itemType(type: string): string | null {
  const m = /^list<(.+)>$/.exec(type);
  return m ? m[1]! : null;
}

/** `ref:task`, `list<ref:task>` → `task`; null — not a reference. */
export function refType(type: string): string | null {
  const t = itemType(type) ?? type;
  return t.startsWith('ref:') ? t.slice(4) : null;
}

/** Field types a document fills by a value (a zone — by its text on the sheet). */
export function isFillable(type: string): boolean {
  return (itemType(type) ?? type) !== 'richtext';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function isCalendarDate(v: string) {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function inBounds(v: number, f: FieldSpec) {
  return Math.abs(v) <= FIELD_LIMITS.bound && (f.min === null || v >= f.min) && (f.max === null || v <= f.max);
}

/** One scalar, normalized (text trimmed, time in UTC); undefined — invalid. */
function scalar(type: string, f: FieldSpec, v: unknown): FieldScalar | undefined {
  switch (type) {
    case 'text': {
      if (typeof v !== 'string') return undefined;
      const t = v.trim();
      return t.length > 0 && t.length <= (f.maxLength ?? FIELD_LIMITS.textDefault) && !/[\r\n]/.test(t) ? t : undefined;
    }
    case 'int':
      return Number.isInteger(v) && inBounds(v as number, f) ? (v as number) : undefined;
    case 'decimal': {
      const scale = f.scale ?? FIELD_LIMITS.scaleDefault;
      return typeof v === 'number' && Number.isFinite(v) && Number(v.toFixed(scale)) === v && inBounds(v, f) ? v : undefined;
    }
    case 'date':
      return typeof v === 'string' && isCalendarDate(v) ? v : undefined;
    case 'datetime':
      return typeof v === 'string' && DATETIME.test(v) && !isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : undefined;
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    case 'enum':
      return typeof v === 'string' && v.length > 0 && v.length <= FIELD_LIMITS.keyMax ? v : undefined;
    case 'color':
      return typeof v === 'string' && (COLORS as readonly string[]).includes(v) ? v : undefined;
    default:
      // ref:<type> — the id of a record; whether it exists and is seen — the API's check.
      return type.startsWith('ref:') && typeof v === 'string' && RECORD_ID.test(v) ? v : undefined;
  }
}

/**
 * A value for the field, normalized. null — the field is empty (null, empty
 * text, empty list); undefined — invalid. Choices of `enum` are checked
 * against the field's options by the caller.
 */
export function normalizeValue(f: FieldSpec, v: unknown): FieldValue | null | undefined {
  if (!isFillable(f.type)) return undefined;
  if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (f.type === ROWS) return normalizeRows(f, v);
  const item = itemType(f.type);
  if (item === null) return scalar(f.type, f, v);
  if (!Array.isArray(v)) return undefined;
  if (v.length === 0) return null;
  if (v.length > (f.maxItems ?? FIELD_LIMITS.itemsDefault)) return undefined;
  const out: FieldScalar[] = [];
  for (const x of v) {
    const n = scalar(item, f, x);
    if (n === undefined) return undefined;
    out.push(n);
  }
  // A choice (a record) is made once.
  if ((item === 'enum' || item === 'color' || item.startsWith('ref:')) && new Set(out).size !== out.length) return undefined;
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * A row of «Повторювані рядки», normalized: only its columns, each valid
 * (empty cells go; a row of empty cells stays — a draft keeps a row just
 * added). undefined — invalid.
 */
export function normalizeRow(columns: readonly FieldSpec[], v: unknown): FieldRow | undefined {
  if (!isRecord(v)) return undefined;
  const out: FieldRow = {};
  for (const [key, raw] of Object.entries(v)) {
    const c = columns.find((x) => x.key === key);
    if (!c || c.type === ROWS) return undefined;
    const n = normalizeValue(c, raw);
    if (n === undefined) return undefined;
    if (n !== null) out[key] = n as FieldScalar | FieldScalar[];
  }
  return out;
}

/** Rows of a `rows` field: a list of rows within its limit; no rows — empty (null). */
function normalizeRows(f: FieldSpec, v: unknown): FieldRow[] | null | undefined {
  if (!Array.isArray(v)) return undefined;
  if (v.length === 0) return null;
  if (v.length > (f.maxItems ?? FIELD_LIMITS.rowsDefault)) return undefined;
  const out: FieldRow[] = [];
  for (const x of v) {
    const row = normalizeRow(f.columns ?? [], x);
    if (row === undefined) return undefined;
    out.push(row);
  }
  return out;
}

/** The rows a value holds (not rows — none). */
export function rowsIn(v: FieldValue | undefined): FieldRow[] {
  return Array.isArray(v) ? v.filter((x): x is FieldRow => isRecord(x)) : [];
}

/** A row with no cell filled. */
export function isEmptyRow(row: FieldRow): boolean {
  return Object.keys(row).length === 0;
}

/** Choices of an `enum` value (one or a list). */
export function choicesOf(v: FieldValue | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');
}

const TZ = 'Europe/Kyiv';
const DATETIME_TEXT = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const NUMBER_TEXT = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 6 });
const DAY_TEXT = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
const YEAR_TEXT = new Intl.DateTimeFormat('uk-UA', { year: 'numeric', timeZone: TZ });

/** A moment as a day in Kyiv: «15.11.2026». */
export function dayText(at: Date | string): string {
  return DAY_TEXT.format(new Date(at));
}

/** The year of a moment in Kyiv: «2026». */
export function yearText(at: Date | string): string {
  return YEAR_TEXT.format(new Date(at)).replace(/\D/g, '');
}

/** A name as documents sign it (ДСТУ 4163): «Артур Машталер» → «Артур МАШТАЛЕР». One word stays as it is. */
export function signName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join('');
  const last = words.pop()!;
  return [...words, last.toLocaleUpperCase('uk-UA')].join(' ');
}

const COLOR_TEXT: Record<string, string> = {
  gray: 'сірий',
  red: 'червоний',
  orange: 'помаранчевий',
  yellow: 'жовтий',
  green: 'зелений',
  teal: 'бірюзовий',
  blue: 'синій',
  purple: 'фіолетовий',
};

/** Title of a record a value or a reference points to; null — not seen (or no more). */
export type RecordTitle = (type: string, id: string) => string | null;

/** In place of a record the reader does not see, or one deleted. */
export const RECORD_MISSING = 'запис недоступний';

function scalarText(type: string, v: FieldScalar, options: readonly FieldOption[] | null, title: RecordTitle | null): string {
  if (type.startsWith('ref:')) return title?.(type.slice(4), String(v)) ?? RECORD_MISSING;
  switch (type) {
    case 'int':
    case 'decimal':
      return typeof v === 'number' ? NUMBER_TEXT.format(v) : String(v);
    case 'date': {
      const [y, m, d] = String(v).split('-');
      return `${d}.${m}.${y}`;
    }
    case 'datetime':
      return DATETIME_TEXT.format(new Date(String(v)));
    case 'bool':
      return v ? 'так' : 'ні';
    case 'enum':
      return options?.find((o) => o.key === v)?.label ?? String(v);
    case 'color':
      return COLOR_TEXT[String(v)] ?? String(v);
    default:
      return String(v);
  }
}

/** How a value reads on the sheet and in the print: «12», «15.12.2026», «так», a record's title. */
export function valueText(type: string, v: FieldValue, options: readonly FieldOption[] | null = null, title: RecordTitle | null = null): string {
  if (type === ROWS) return rowsText(rowsIn(v).length);
  const item = itemType(type);
  if (item === null) return scalarText(type, v as FieldScalar, options, title);
  return (Array.isArray(v) ? (v as FieldScalar[]) : [v as FieldScalar]).map((x) => scalarText(item, x, options, title)).join(', ');
}

/** «1 рядок», «3 рядки», «5 рядків». */
export function rowsText(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  const word = d === 1 && dd !== 11 ? 'рядок' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'рядки' : 'рядків';
  return `${n} ${word}`;
}

/** A record a document refers to. */
export type RecordRef = { type: string; id: string };

export type RefField = { key: string; type: string; columns?: readonly RefField[] | null };

/**
 * A record a field's value refers to; `key` — the field's (a column's, for
 * «Повторювані рядки»: `rows` — the rows field, `row` — the first row with it).
 */
export type ValueRef = RecordRef & { key: string; rows?: string; row?: number };

/** Records of the values of reference fields, each once a field (a column — once for all its rows). */
export function valueRefs(fields: readonly RefField[], values: FieldValues): ValueRef[] {
  const out: ValueRef[] = [];
  for (const f of fields) {
    if (f.type === ROWS) {
      const rows = rowsIn(values[f.key]);
      for (const c of f.columns ?? []) {
        const type = refType(c.type);
        if (type === null) continue;
        const first = new Map<string, number>();
        rows.forEach((r, i) => {
          const v = r[c.key];
          if (v === undefined) return;
          for (const id of (Array.isArray(v) ? v : [v]).map(String)) if (!first.has(id)) first.set(id, i);
        });
        for (const [id, row] of first) out.push({ key: c.key, type, id, rows: f.key, row });
      }
      continue;
    }
    const type = refType(f.type);
    const v = values[f.key];
    if (type === null || v === undefined) continue;
    for (const id of new Set((Array.isArray(v) ? v : [v]).map(String))) out.push({ key: f.key, type, id });
  }
  return out;
}

/** Records the text refers to («@»), each once, in order. */
export function mentionsOf(doc: PaperNode): RecordRef[] {
  const seen = new Set<string>();
  const out: RecordRef[] = [];
  walkNodes(doc, (n) => {
    if (n.type !== 'mention') return;
    const type = n.attrs?.type as string;
    const id = n.attrs?.id as string;
    if (seen.has(`${type}:${id}`)) return;
    seen.add(`${type}:${id}`);
    out.push({ type, id });
  });
  return out;
}

// --- the document and its template's body ---

const ATTR_DEFAULTS = (rules: Record<string, { default: unknown }>, attrs: PaperAttrs | undefined) =>
  Object.fromEntries(Object.keys(rules).map((k) => [k, attrs?.[k] !== undefined ? attrs[k] : rules[k]!.default]));

const MARK_ORDER = Object.keys(MARKS);

function sameMarks(a: PaperMark[], b: PaperMark[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The node in one form, whoever wrote it: every attribute (defaults filled in),
 * marks in the editor's order, neighbouring texts with the same marks joined.
 * `emptyZones` — zones without their text (the author's part of a document).
 */
function canonical(n: PaperNode, emptyZones: boolean): PaperNode {
  const rule = NODES[n.type];
  const out: PaperNode = { type: n.type };
  if (rule && Object.keys(rule.attrs).length) out.attrs = ATTR_DEFAULTS(rule.attrs, n.attrs);
  if (n.type === 'text') {
    out.text = n.text ?? '';
    const marks = (n.marks ?? [])
      .map((m) => ({ type: m.type, ...(MARKS[m.type] && Object.keys(MARKS[m.type]!.attrs).length ? { attrs: ATTR_DEFAULTS(MARKS[m.type]!.attrs, m.attrs) } : {}) }))
      .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    if (marks.length) out.marks = marks;
    return out;
  }
  if (n.type === 'fieldZone' && emptyZones) return out;
  const children: PaperNode[] = [];
  for (const c of (n.content ?? []).map((x) => canonical(x, emptyZones))) {
    const last = children[children.length - 1];
    if (c.type === 'text' && last?.type === 'text' && sameMarks(last.marks ?? [], c.marks ?? [])) last.text += c.text!;
    else children.push(c);
  }
  if (children.length) out.content = children;
  return out;
}

/** The document keeps to the template's body: it differs only inside zones. */
export function matchesBody(content: PaperNode, body: PaperNode): boolean {
  return JSON.stringify(canonical(content, true)) === JSON.stringify(canonical(body, true));
}

/** The same nodes, however written (attributes with defaults, marks in order). */
export function sameNodes(a: PaperNode | undefined, b: PaperNode | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(canonical(a, false)) === JSON.stringify(canonical(b, false));
}

/** Calls `visit` for every node, parents first. */
export function walkNodes(n: PaperNode, visit: (n: PaperNode, insideZone: boolean) => void, insideZone = false) {
  visit(n, insideZone);
  const inside = insideZone || n.type === 'fieldZone';
  for (const c of n.content ?? []) walkNodes(c, visit, inside);
}

// --- conditional blocks ---

/**
 * What a conditional block waits for in the field `field`: a choice of a
 * choice field (`enum` — it is chosen, `list<enum>` — it is among the chosen),
 * `@yes` / `@no` — a checkbox is ticked or not, `@filled` — any other field
 * a person fills holds a value.
 */
export type Condition = { field: string; value: string };

export const IF_YES = '@yes';
export const IF_NO = '@no';
export const IF_FILLED = '@filled';

/** The condition of a conditional block; null — not one (or without a valid condition). */
export function conditionOf(n: PaperNode): Condition | null {
  if (n.type !== CONDITIONAL) return null;
  const field = n.attrs?.field;
  const value = n.attrs?.value;
  return typeof field === 'string' && FIELD_KEY.test(field) && typeof value === 'string' && value.length > 0 ? { field, value } : null;
}

/** The condition holds by these values (an empty field has no key in them). */
export function conditionHolds(c: Condition, values: FieldValues): boolean {
  const v = values[c.field];
  switch (c.value) {
    case IF_YES:
      return v === true;
    case IF_NO:
      return v !== true;
    case IF_FILLED:
      return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
    default:
      return choicesOf(v).includes(c.value);
  }
}

/**
 * What a conditional block may wait for in a field of this type: `choices`
 * — a choice of the field, `yesNo` — `@yes` / `@no`, `filled` — `@filled`;
 * null — a field of this type is no condition (a zone, rows). Whether the
 * field itself may be one (not auto, not a column, not in a conditional
 * block) — the template's check.
 */
export function conditionKind(type: string): 'choices' | 'yesNo' | 'filled' | null {
  if (type === 'enum' || type === 'list<enum>') return 'choices';
  if (type === 'bool') return 'yesNo';
  return type === ROWS || !isFillable(type) ? null : 'filled';
}

/** The value fits a field of this type (see conditionKind); choices — the field's option keys. */
export function conditionFits(type: string, value: string, choices: readonly string[]): boolean {
  switch (conditionKind(type)) {
    case 'choices':
      return choices.includes(value);
    case 'yesNo':
      return value === IF_YES || value === IF_NO;
    case 'filled':
      return value === IF_FILLED;
    default:
      return false;
  }
}

/**
 * Fields and zones of conditional blocks whose condition does not hold by
 * `values`: not in the document now — not required, not printed, not sent
 * to the record (the draft keeps their values until it is published).
 */
export function offFields(doc: PaperNode, values: FieldValues): Set<string> {
  const out = new Set<string>();
  for (const n of doc.content ?? []) {
    if (n.type !== CONDITIONAL) continue;
    const c = conditionOf(n);
    if (c && conditionHolds(c, values)) continue;
    walkNodes(n, (x) => {
      if (x.type === 'field' || x.type === 'fieldZone') out.add(x.attrs?.key as string);
    });
  }
  return out;
}

// --- «Повторювані рядки» ---

/** The table of a «Повторювані рядки» block: its header rows and the row that repeats (null — no rows). */
export function repeatParts(n: PaperNode): { table: PaperNode | null; header: PaperNode[]; row: PaperNode | null } {
  const table = n.content?.[0]?.type === 'table' ? n.content[0] : null;
  const rows = table?.content ?? [];
  return { table, header: rows.slice(0, -1), row: rows[rows.length - 1] ?? null };
}

/**
 * Blocks «Повторювані рядки» of the top level: the key of the `rows` field
 * of each and the keys of its columns — fields of the row that repeats, each
 * once, in the order of the sheet.
 */
export function rowsOf(doc: PaperNode): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of doc.content ?? []) {
    if (n.type !== REPEAT || typeof n.attrs?.key !== 'string') continue;
    const keys = new Set<string>();
    const { row } = repeatParts(n);
    if (row) {
      walkNodes(row, (x) => {
        if (x.type === 'field') keys.add(x.attrs?.key as string);
      });
    }
    out.set(n.attrs.key, [...keys]);
  }
  return out;
}

/** Every zone of the document. */
export function zonesOf(doc: PaperNode): PaperNode[] {
  const out: PaperNode[] = [];
  walkNodes(doc, (n) => {
    if (n.type === 'fieldZone') out.push(n);
  });
  return out;
}

/** A field inside a zone (a field or a zone in it) — not allowed. */
export function hasFieldInsideZone(doc: PaperNode): boolean {
  let found = false;
  walkNodes(doc, (n, inside) => {
    if (inside && (n.type === 'field' || n.type === 'fieldZone')) found = true;
  });
  return found;
}

const PLAIN_PARAGRAPH = (p: PaperNode) =>
  p.type === 'paragraph' && !p.attrs?.align && !p.attrs?.indent && (p.content ?? []).every((c) => (c.type === 'text' || c.type === 'hardBreak') && !(c.marks ?? []).length);

/**
 * A zone bound to a text field of a record holds plain text: paragraphs
 * without formatting.
 */
export function isPlainZone(zone: PaperNode): boolean {
  return (zone.content ?? []).every(PLAIN_PARAGRAPH);
}

/** The text of a zone: paragraphs by a line break each. */
export function zoneText(zone: PaperNode): string {
  const lines: string[] = [];
  const walk = (n: PaperNode, out: string[]) => {
    if (n.type === 'text') out.push(n.text ?? '');
    else if (n.type === 'hardBreak') out.push('\n');
    else (n.content ?? []).forEach((c) => walk(c, out));
  };
  for (const block of zone.content ?? []) {
    const out: string[] = [];
    walk(block, out);
    lines.push(out.join(''));
  }
  return lines.join('\n').trim();
}

/** The document with the zone `key` holding `text`: a paragraph a line, no formatting. */
export function withZoneText<T extends PaperNode>(doc: T, key: string, text: string): T {
  const paragraphs: PaperNode[] = text.split('\n').map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' }));
  const put = (n: PaperNode): PaperNode => (n.type === 'fieldZone' && n.attrs?.key === key ? { ...n, content: paragraphs } : n.content ? { ...n, content: n.content.map(put) } : n);
  return put(doc) as T;
}
