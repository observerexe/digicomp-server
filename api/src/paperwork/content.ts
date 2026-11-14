import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * Document content: ProseMirror JSON. Here only its general shape is
 * checked; which nodes, marks and attributes are allowed is the job of the
 * shared editor schema.
 */
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
  /** Attributes of one node or mark. */
  attrs: 30,
  /** Characters of one attribute key or string value. */
  attrString: 2000,
} as const;

/** A new document: one empty paragraph. */
export const EMPTY_CONTENT: PaperContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const NODE_KEYS = new Set(['type', 'attrs', 'content', 'text', 'marks']);
const MARK_KEYS = new Set(['type', 'attrs']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function isScalar(v: unknown): boolean {
  return (
    v === null ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.length <= CONTENT_LIMITS.attrString)
  );
}

/** Attribute values: scalars or flat lists of them (column widths). */
function validAttrs(v: unknown): boolean {
  if (v === undefined) return true;
  if (!isPlainObject(v)) return false;
  const entries = Object.entries(v);
  return (
    entries.length <= CONTENT_LIMITS.attrs &&
    entries.every(
      ([k, x]) =>
        TYPE_NAME.test(k) &&
        (isScalar(x) ||
          (Array.isArray(x) && x.length <= 100 && x.every(isScalar))),
    )
  );
}

function validMark(v: unknown): boolean {
  return (
    isPlainObject(v) &&
    Object.keys(v).every((k) => MARK_KEYS.has(k)) &&
    typeof v.type === 'string' &&
    TYPE_NAME.test(v.type) &&
    validAttrs(v.attrs)
  );
}

/** Whether `v` has the shape of a ProseMirror document within the limits. */
export function isPaperContent(v: unknown): v is PaperContent {
  if (!isPlainObject(v) || v.type !== 'doc') return false;
  let nodes = 0;
  const walk = (n: unknown, depth: number): boolean => {
    if (++nodes > CONTENT_LIMITS.nodes || depth > CONTENT_LIMITS.depth) {
      return false;
    }
    if (!isPlainObject(n) || !Object.keys(n).every((k) => NODE_KEYS.has(k))) {
      return false;
    }
    if (typeof n.type !== 'string' || !TYPE_NAME.test(n.type)) return false;
    if (!validAttrs(n.attrs)) return false;
    if (n.marks !== undefined) {
      if (!Array.isArray(n.marks) || !n.marks.every(validMark)) return false;
    }
    if (n.type === 'text') {
      // A text node: non-empty text, no children.
      return (
        typeof n.text === 'string' &&
        n.text.length > 0 &&
        n.content === undefined
      );
    }
    if (n.text !== undefined) return false;
    if (n.content === undefined) return true;
    return (
      Array.isArray(n.content) && n.content.every((c) => walk(c, depth + 1))
    );
  };
  return walk(v, 0);
}

/** DTO check: a ProseMirror document (see isPaperContent). */
export function IsPaperContent(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isPaperContent',
      validator: {
        validate: (v) => isPaperContent(v),
        defaultMessage: () => '$property must be a document (type: doc)',
      },
    },
    options,
  );
}
