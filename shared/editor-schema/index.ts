/**
 * The one description of editor documents, shared by the web editor
 * (web/src/editor/) and the API (content check, print: render.ts, paper.css).
 *
 * No package imports on purpose: both packages compile this folder as their own source
 * (see docs/tech/DEVELOPMENT.md, «Спільний опис редактора»).
 *
 * Formatting is classes only: CSP `style-src 'self'` forbids the `style`
 * attribute, so no node or mark carries one.
 */

/** Text sizes, pt. Without a size — the sheet's own (DEFAULT_FONT_SIZE). */
export const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28] as const;
export const DEFAULT_FONT_SIZE = 14;

/** Text colours: names from the palette in docs/design/tokens.json (the sheet takes light.text). */
export const COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple'] as const;

/**
 * The sheet's colours (--sheet-* in paper.css): always white, light values in both themes.
 * From docs/design/tokens.json: paper — color.light.surface, ink — color.light.text,
 * the rest — palette.<name>.light.text. The web takes them from tokens.css; the print
 * from here (api/src/paperwork/print.spec.ts checks they match tokens.json).
 */
export const SHEET_COLORS = {
  paper: '#FFFFFF',
  ink: '#0E1A2B',
  gray: '#46566E',
  red: '#B42828',
  orange: '#A4480A',
  yellow: '#7D5A00',
  green: '#17784A',
  teal: '#0E6E73',
  blue: '#1A54BF',
  purple: '#6B3FC2',
} as const satisfies Record<'paper' | 'ink' | TextColor, string>;

/** Fonts. Without a font — serif (Times New Roman, Liberation Serif). */
export const FONTS = ['serif', 'sans'] as const;

/** Paragraph alignment. Without it — left. */
export const ALIGNS = ['center', 'right', 'justify'] as const;

/** Left indent: steps of INDENT_STEP_MM, from 0 to MAX_INDENT. */
export const INDENT_STEP_MM = 5;
export const MAX_INDENT = 6;

export const HEADING_LEVELS = [1, 2, 3] as const;

export type FontSize = (typeof FONT_SIZES)[number];
export type TextColor = (typeof COLORS)[number];
export type FontName = (typeof FONTS)[number];
export type Align = (typeof ALIGNS)[number];

/** Class names of the formatting attributes. */
export const formatClass = {
  size: (v: FontSize) => `fs-${v}`,
  color: (v: TextColor) => `tc-${v}`,
  font: (v: FontName) => `ff-${v}`,
  align: (v: Align) => `ta-${v}`,
  indent: (v: number) => `in-${v}`,
};

/** Every formatting class (the CSS of the editor and of the print has a rule for each). */
export function formatClasses(): string[] {
  return [
    ...FONT_SIZES.map(formatClass.size),
    ...COLORS.map(formatClass.color),
    ...FONTS.map(formatClass.font),
    ...ALIGNS.map(formatClass.align),
    ...Array.from({ length: MAX_INDENT }, (_, i) => formatClass.indent(i + 1)),
  ];
}

/** Attribute of a node or mark: its default and which values are allowed. */
export type AttrRule = { default: unknown; valid: (v: unknown) => boolean };

const oneOf =
  (values: readonly unknown[], nullable = true) =>
  (v: unknown) =>
    (nullable && v === null) || values.includes(v);
const intIn = (min: number, max: number) => (v: unknown) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

const BLOCK_FORMAT: Record<string, AttrRule> = {
  align: { default: null, valid: oneOf(ALIGNS) },
  indent: { default: 0, valid: intIn(0, MAX_INDENT) },
};

/** Table cells: no column widths (they would need `style`), merged cells are fine. */
const CELL: Record<string, AttrRule> = {
  colspan: { default: 1, valid: intIn(1, 50) },
  rowspan: { default: 1, valid: intIn(1, 500) },
  colwidth: { default: null, valid: (v) => v === null },
};

export type NodeRule = {
  attrs: Record<string, AttrRule>;
  /** Allowed children (any order; the editor keeps the order); without it — a leaf. */
  children?: readonly string[];
};

const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'table', 'pageBreak', 'fieldZone'] as const;
/** Structure of the sheet: only on its top level (not in a list, a table or a zone). */
export const STRUCTURE = ['orgHeader', 'approval', 'signatures', 'pageFooter'] as const;
const INLINE = ['text', 'hardBreak', 'field', 'mention', 'paperNumber', 'paperDate', 'paperAuthor'] as const;

/** Key of a template field: Latin, starts with a small letter (`title`, `goal_2`). */
export const FIELD_KEY = /^[a-z][a-zA-Z0-9_]{0,39}$/;
const fieldKey: AttrRule = { default: null, valid: (v) => typeof v === 'string' && FIELD_KEY.test(v) };

/** A record type (`task`, `inventory_item`); which ones may be referred to — the API decides. */
export const RECORD_TYPE_KEY = /^[a-z][a-z_]{0,39}$/;
/** Id of a record: a UUID in lower case. */
export const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** One line of text up to `max` characters: no line breaks or other control characters. */
const lineOf =
  (max: number): AttrRule['valid'] =>
  (v) =>
    typeof v === 'string' && v.length <= max && ![...v].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
export const SIGN_LABEL_MAX = 100;
export const FOOTER_MAX = 200;

/** Who signs a column: the document's author, the signer from «Реквізити», or a `ref:user` field of the template (its key). */
export const SIGNER_AUTHOR = '@author';
export const SIGNER_ORG = '@signer';
const signer: AttrRule = { default: null, valid: (v) => v === null || v === SIGNER_AUTHOR || v === SIGNER_ORG || (typeof v === 'string' && FIELD_KEY.test(v)) };
/** The key of the template field a signature column takes its name from; null — not a field. */
export function signerField(v: unknown): string | null {
  return typeof v === 'string' && FIELD_KEY.test(v) ? v : null;
}

const recordType: AttrRule = { default: null, valid: (v) => typeof v === 'string' && RECORD_TYPE_KEY.test(v) };
const recordId: AttrRule = { default: null, valid: (v) => typeof v === 'string' && RECORD_ID.test(v) };

export const NODES: Record<string, NodeRule> = {
  doc: { attrs: {}, children: [...BLOCKS, ...STRUCTURE] },
  paragraph: { attrs: BLOCK_FORMAT, children: INLINE },
  heading: {
    attrs: { level: { default: 1, valid: oneOf(HEADING_LEVELS, false) }, ...BLOCK_FORMAT },
    children: INLINE,
  },
  text: { attrs: {} },
  hardBreak: { attrs: {} },
  bulletList: { attrs: {}, children: ['listItem'] },
  orderedList: { attrs: { start: { default: 1, valid: intIn(0, 100_000) } }, children: ['listItem'] },
  listItem: { attrs: {}, children: BLOCKS },
  table: { attrs: {}, children: ['tableRow'] },
  tableRow: { attrs: {}, children: ['tableCell', 'tableHeader'] },
  tableCell: { attrs: CELL, children: BLOCKS },
  tableHeader: { attrs: CELL, children: BLOCKS },
  pageBreak: { attrs: {} },
  /** A template field: its value lives in the document's `values`, not here. */
  field: { attrs: { key: fieldKey } },
  /** A free zone (`richtext` field): text the author writes on the sheet itself. */
  fieldZone: { attrs: { key: fieldKey }, children: BLOCKS },
  /** A reference to a record («@»): only type and id; the title comes from the record itself. */
  mention: { attrs: { type: recordType, id: recordId } },
  /** «Авто: номер»: the document's number, given when it is published. */
  paperNumber: { attrs: {} },
  /** «Авто: дата»: the day the document is published. */
  paperDate: { attrs: {} },
  /** «Авто: автор»: the document's author («Ім'я ПРІЗВИЩЕ»). */
  paperAuthor: { attrs: {} },
  /** «Шапка»: institution and group from «Реквізити». */
  orgHeader: { attrs: {} },
  /** «Гриф «Затверджую»»: the signer and their position from «Реквізити». */
  approval: { attrs: {} },
  /** «Блок підписів»: one or two columns, each — a label and who signs (a right column without a label — none). */
  signatures: {
    attrs: {
      leftLabel: { default: 'Склав', valid: lineOf(SIGN_LABEL_MAX) },
      leftSigner: { ...signer, default: SIGNER_AUTHOR },
      rightLabel: { default: '', valid: lineOf(SIGN_LABEL_MAX) },
      rightSigner: signer,
    },
  },
  /** «Колонтитул»: a line at the foot of every printed page. */
  pageFooter: { attrs: { text: { default: '', valid: lineOf(FOOTER_MAX) } } },
};

/** In the editor's order: marks nest in it (textStyle outermost, underline innermost). */
export const MARKS: Record<string, { attrs: Record<string, AttrRule> }> = {
  textStyle: {
    attrs: {
      size: { default: null, valid: oneOf(FONT_SIZES) },
      color: { default: null, valid: oneOf(COLORS) },
      font: { default: null, valid: oneOf(FONTS) },
    },
  },
  bold: { attrs: {} },
  italic: { attrs: {} },
  strike: { attrs: {} },
  underline: { attrs: {} },
};

/** Document content: ProseMirror JSON. */
export type PaperAttrs = Record<string, unknown>;
export type PaperMark = { type: string; attrs?: PaperAttrs };
export type PaperNode = {
  type: string;
  attrs?: PaperAttrs;
  content?: PaperNode[];
  text?: string;
  marks?: PaperMark[];
};
export type PaperContent = PaperNode & { type: 'doc' };

export const CONTENT_LIMITS = {
  /** Nesting of nodes (lists in tables in lists…). */
  depth: 40,
  /** Nodes in the whole document, text nodes included. */
  nodes: 50_000,
} as const;

/** A new document: one empty paragraph. */
export const EMPTY_CONTENT: PaperContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const NODE_KEYS = new Set(['type', 'attrs', 'content', 'text', 'marks']);
const MARK_KEYS = new Set(['type', 'attrs']);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** A JSON object (ProseMirror builds attributes with a null prototype). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Only declared attributes, each with an allowed value. */
function validAttrs(v: unknown, rules: Record<string, AttrRule>): boolean {
  if (v === undefined) return true;
  if (!isPlainObject(v)) return false;
  return Object.entries(v).every(([k, x]) => own(rules, k) && rules[k]!.valid(x));
}

function validMark(v: unknown): boolean {
  if (!isPlainObject(v) || !Object.keys(v).every((k) => MARK_KEYS.has(k))) return false;
  if (typeof v.type !== 'string' || !own(MARKS, v.type)) return false;
  return validAttrs(v.attrs, MARKS[v.type]!.attrs);
}

/**
 * Whether `v` is a document of this schema within the limits: only known
 * nodes, marks and attribute values, each node only among allowed parents.
 * The order of children (a list item starts with a paragraph) is the editor's job.
 */
export function checkContent(v: unknown): v is PaperContent {
  let nodes = 0;
  const walk = (n: unknown, depth: number, allowed: readonly string[]): boolean => {
    if (++nodes > CONTENT_LIMITS.nodes || depth > CONTENT_LIMITS.depth) return false;
    if (!isPlainObject(n) || !Object.keys(n).every((k) => NODE_KEYS.has(k))) return false;
    if (typeof n.type !== 'string' || !allowed.includes(n.type)) return false;
    const rule = NODES[n.type]!;
    if (!validAttrs(n.attrs, rule.attrs)) return false;
    // A field carries its key: it may not be left out.
    if ((n.type === 'field' || n.type === 'fieldZone') && !(isPlainObject(n.attrs) && own(n.attrs, 'key'))) return false;
    // A reference carries both.
    if (n.type === 'mention' && !(isPlainObject(n.attrs) && own(n.attrs, 'type') && own(n.attrs, 'id'))) return false;
    if (n.marks !== undefined) {
      const inline = (INLINE as readonly string[]).includes(n.type);
      if (!inline || !Array.isArray(n.marks) || !n.marks.every(validMark)) return false;
    }
    if (n.type === 'text') {
      // A text node: non-empty text, no children.
      return typeof n.text === 'string' && n.text.length > 0 && n.content === undefined;
    }
    if (n.text !== undefined) return false;
    if (n.content === undefined) return true;
    const children = rule.children;
    return !!children && Array.isArray(n.content) && n.content.every((c) => walk(c, depth + 1, children));
  };
  return walk(v, 0, ['doc']);
}
