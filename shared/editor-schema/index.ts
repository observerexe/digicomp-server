/**
 * The one description of editor documents, shared by the web editor
 * (web/src/editor/) and the API (content check, later the print render).
 *
 * No imports on purpose: both packages compile this file as their own source
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

const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'table', 'pageBreak'] as const;
const INLINE = ['text', 'hardBreak'] as const;

export const NODES: Record<string, NodeRule> = {
  doc: { attrs: {}, children: BLOCKS },
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
};

export const MARKS: Record<string, { attrs: Record<string, AttrRule> }> = {
  bold: { attrs: {} },
  italic: { attrs: {} },
  underline: { attrs: {} },
  strike: { attrs: {} },
  textStyle: {
    attrs: {
      size: { default: null, valid: oneOf(FONT_SIZES) },
      color: { default: null, valid: oneOf(COLORS) },
      font: { default: null, valid: oneOf(FONTS) },
    },
  },
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
