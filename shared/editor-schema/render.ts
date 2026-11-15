/**
 * Document content → HTML, the same HTML the web editor gives
 * (web/src/editor/render.test.ts compares it with TipTap's generateHTML).
 * The API prints with it; the look is paper.css.
 *
 * Only what the description allows gets out: known nodes and marks,
 * attributes as format classes or checked numbers, escaped text.
 */
import { RECORD_MISSING } from './fields';
import { formatClass, MARKS, NODES, SIGNER_AUTHOR, SIGNER_ORG, type PaperAttrs, type PaperMark, type PaperNode } from './index';

const TEXT_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\u00a0': '&nbsp;' };

function escapeText(s: string): string {
  return s.replace(/[&<>\u00a0]/g, (c) => TEXT_ESCAPES[c]!);
}

/** An attribute's value, as the DOM serializes it. */
function escapeAttr(s: string): string {
  return s.replace(/[&"\u00a0]/g, (c) => TEXT_ESCAPES[c]!);
}

/** Attribute value: valid by the description, otherwise its default. */
function attr(rules: Record<string, { default: unknown; valid: (v: unknown) => boolean }>, attrs: PaperAttrs | undefined, name: string): unknown {
  const rule = rules[name]!;
  const v = attrs?.[name];
  return v !== undefined && rule.valid(v) ? v : rule.default;
}

function tag(name: string, attrs: [string, string | number | null][] = []): string {
  const list = attrs.filter(([, v]) => v !== null && v !== '').map(([k, v]) => ` ${k}="${v}"`);
  return `<${name}${list.join('')}>`;
}

function classes(...list: (string | null)[]): string | null {
  return list.filter(Boolean).join(' ') || null;
}

const nodeAttr = (n: PaperNode, name: string) => attr(NODES[n.type]!.attrs, n.attrs, name);
/** Keys match FIELD_KEY: nothing to escape. */
const fieldKey = (n: PaperNode) => nodeAttr(n, 'key') as string | null;

/** What the structure of the sheet shows: requisites, who signs, the day and the year. */
export type PaperInfo = {
  institution: string;
  groupName: string;
  signerPosition: string;
  /**
   * The name a signature shows («Ім'я ПРІЗВИЩЕ») for who signs: SIGNER_AUTHOR,
   * SIGNER_ORG or a field's key; null — a line to sign by hand.
   */
  person(signer: string): string | null;
  /** «Авто: дата»: the day the document is published («15.11.2026»); null — not yet. */
  date: string | null;
  /** The year of «Затверджую»: «2026». */
  year: string;
};

/**
 * Values of fields for the print. Without it the HTML is the editor's own
 * (a field — an empty placeholder).
 */
export type FieldFill = {
  /** The value as text; null — empty (a line to fill in by hand). */
  text(key: string): string | null;
  /** Not in the print at all (the field's `print` is off). */
  hidden(key: string): boolean;
  /** Title of a record the text refers to («@»); null — not seen (or no more). */
  title(type: string, id: string): string | null;
  /** The document's number; null — none yet (a line to fill in by hand). */
  number: string | null;
  info: PaperInfo;
};

const BLANK = '<span class="paper-field-blank"></span>';
const p = (cls: string | null, html: string) => `${tag('p', [['class', cls]])}${html}</p>`;

/** A line to sign on and the name after it (none — the line alone). */
function signLine(name: string | null): string {
  return p('paper-sign', `<span class="paper-sign-line"></span>${name ? `<span class="paper-sign-name">${escapeText(name)}</span>` : ''}`);
}

/**
 * What the structure blocks hold (the editor draws the same inside its own
 * element); null — not a structure block, or nothing to show (a header
 * without requisites).
 */
export function structureInner(n: PaperNode, info: PaperInfo): string | null {
  switch (n.type) {
    case 'orgHeader': {
      const lines = [info.institution.trim() && p('paper-org-institution', escapeText(info.institution.trim())), info.groupName.trim() && p('paper-org-group', escapeText(info.groupName.trim()))];
      return lines.filter(Boolean).join('') || null;
    }
    case 'approval':
      return (
        p('paper-approval-title', 'ЗАТВЕРДЖУЮ') +
        (info.signerPosition.trim() ? p(null, escapeText(info.signerPosition.trim())) : '') +
        signLine(info.person(SIGNER_ORG)) +
        p('paper-approval-date', `«<span class="paper-sign-day"></span>» <span class="paper-sign-month"></span> ${escapeText(info.year)} р.`)
      );
    case 'signatures': {
      const column = (side: 'left' | 'right') => {
        const label = nodeAttr(n, `${side}Label`) as string;
        const signer = nodeAttr(n, `${side}Signer`) as string | null;
        return `<div class="paper-signs-col">${p(null, escapeText(label))}${signLine(signer === null ? null : info.person(signer))}</div>`;
      };
      return column('left') + ((nodeAttr(n, 'rightLabel') as string) ? column('right') : '');
    }
    default:
      return null;
  }
}

/** The text of the page footer (the first «Колонтитул»); '' — none. */
export function footerText(doc: PaperNode): string {
  const f = (doc.content ?? []).find((n) => n.type === 'pageFooter');
  return f ? ((nodeAttr(f, 'text') as string) ?? '').trim() : '';
}

/** The class of each structure block's element. */
export const STRUCTURE_CLASS: Record<string, string> = {
  orgHeader: 'paper-org',
  approval: 'paper-approval',
  signatures: 'paper-signs',
  pageFooter: 'paper-footer',
};

/** A structure block: in the editor's HTML — its element with attributes only; in the print — with what it shows. */
function renderStructure(n: PaperNode, fill: FieldFill | undefined): string {
  const cls = STRUCTURE_CLASS[n.type]!;
  if (!fill) {
    const attrs: [string, string | null][] =
      n.type === 'signatures'
        ? (['leftLabel', 'leftSigner', 'rightLabel', 'rightSigner'] as const).map((k) => [`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, escapeAttr((nodeAttr(n, k) as string | null) ?? '')])
        : n.type === 'pageFooter'
          ? [['data-text', escapeAttr(nodeAttr(n, 'text') as string)]]
          : [];
    return tag('div', [['class', cls], ...attrs]) + '</div>';
  }
  // The footer goes to the foot of every page (print.ts), not into the text.
  if (n.type === 'pageFooter') return '';
  const inner = structureInner(n, fill.info);
  if (inner === null) return '';
  const name = n.type === 'orgHeader' ? 'header' : 'div';
  return `<${name} class="${cls}">${inner}</${name}>`;
}

/** Classes of a paragraph or heading: alignment, then indent. */
function blockClass(n: PaperNode): string | null {
  const align = nodeAttr(n, 'align') as Parameters<typeof formatClass.align>[0] | null;
  const indent = nodeAttr(n, 'indent') as number;
  return classes(align ? formatClass.align(align) : null, indent ? formatClass.indent(indent) : null);
}

/** A cell's span: only when it is not 1. */
function span(n: PaperNode, name: 'colspan' | 'rowspan'): [string, number | null] {
  const v = nodeAttr(n, name) as number;
  return [name, v === 1 ? null : v];
}

/** Opening and closing tags of an element node; null for leaves rendered whole. */
function element(n: PaperNode): [string, string] | null {
  switch (n.type) {
    case 'paragraph':
      return [tag('p', [['class', blockClass(n)]]), '</p>'];
    case 'heading': {
      const h = `h${nodeAttr(n, 'level') as number}`;
      return [tag(h, [['class', blockClass(n)]]), `</${h}>`];
    }
    case 'bulletList':
      return ['<ul>', '</ul>'];
    case 'orderedList': {
      const start = nodeAttr(n, 'start') as number;
      return [tag('ol', [['start', start === 1 ? null : start]]), '</ol>'];
    }
    case 'listItem':
      return ['<li>', '</li>'];
    case 'table':
      return ['<table><tbody>', '</tbody></table>'];
    case 'tableRow':
      return ['<tr>', '</tr>'];
    case 'tableCell':
      return [tag('td', [span(n, 'colspan'), span(n, 'rowspan')]), '</td>'];
    case 'tableHeader':
      return [tag('th', [span(n, 'colspan'), span(n, 'rowspan')]), '</th>'];
    case 'fieldZone':
      return [tag('div', [['class', 'paper-zone'], ['data-field', fieldKey(n)]]), '</div>'];
    default:
      return null;
  }
}

/** A known mark with every attribute (defaults filled in), so marks compare by value. */
function normalMark(m: PaperMark): { type: string; attrs: PaperAttrs } | null {
  const rule = MARKS[m.type];
  if (!rule) return null;
  return { type: m.type, attrs: Object.fromEntries(Object.keys(rule.attrs).map((k) => [k, attr(rule.attrs, m.attrs, k)])) };
}

const MARK_ORDER = Object.keys(MARKS);

function sameMark(a: { type: string; attrs: PaperAttrs }, b: { type: string; attrs: PaperAttrs }): boolean {
  return a.type === b.type && Object.keys(a.attrs).every((k) => a.attrs[k] === b.attrs[k]);
}

function markTags(m: { type: string; attrs: PaperAttrs }): [string, string] {
  switch (m.type) {
    case 'bold':
      return ['<strong>', '</strong>'];
    case 'italic':
      return ['<em>', '</em>'];
    case 'strike':
      return ['<s>', '</s>'];
    case 'underline':
      return ['<u>', '</u>'];
    default: {
      // textStyle: size, colour, font — in this order, as the editor writes them.
      const { size, color, font } = m.attrs as { size: never; color: never; font: never };
      const cls = classes(size ? formatClass.size(size) : null, color ? formatClass.color(color) : null, font ? formatClass.font(font) : null);
      return [tag('span', [['class', cls]]), '</span>'];
    }
  }
}

/**
 * Inline children of a block. Marks stay open across neighbours that share
 * them (as ProseMirror's DOMSerializer does): `<strong>a<em>b</em></strong>`.
 */
function renderField(n: PaperNode, fill: FieldFill | undefined): string {
  const key = fieldKey(n);
  if (!fill) return tag('span', [['class', 'paper-field'], ['data-field', key]]) + '</span>';
  if (key === null || fill.hidden(key)) return '';
  const text = fill.text(key);
  return text === null ? BLANK : `<span class="paper-field">${escapeText(text)}</span>`;
}

/** A reference: the title of the record in the print; in the editor's HTML — only what it points to. */
function renderMention(n: PaperNode, fill: FieldFill | undefined): string {
  const type = nodeAttr(n, 'type') as string | null;
  const id = nodeAttr(n, 'id') as string | null;
  // Type and id match RECORD_TYPE_KEY and RECORD_ID: nothing to escape.
  if (!fill) return tag('span', [['class', 'paper-ref'], ['data-ref-type', type], ['data-ref-id', id]]) + '</span>';
  const title = type && id ? fill.title(type, id) : null;
  return `<span class="paper-ref">${escapeText(title ?? RECORD_MISSING)}</span>`;
}

/** «Авто: номер»: the number in the print; in the editor's HTML — an empty placeholder. */
function renderNumber(fill: FieldFill | undefined): string {
  if (!fill) return '<span class="paper-number"></span>';
  return fill.number === null ? BLANK : `<span class="paper-field">${escapeText(fill.number)}</span>`;
}

/** «Авто: дата», «Авто: автор»: the text in the print (none yet — a line); in the editor's HTML — an empty placeholder. */
function renderAuto(n: PaperNode, fill: FieldFill | undefined): string {
  const cls = n.type === 'paperDate' ? 'paper-date' : 'paper-author';
  if (!fill) return `<span class="${cls}"></span>`;
  const text = n.type === 'paperDate' ? fill.info.date : fill.info.person(SIGNER_AUTHOR);
  return text === null ? BLANK : `<span class="paper-field">${escapeText(text)}</span>`;
}

function renderInline(children: PaperNode[], fill: FieldFill | undefined): string {
  let out = '';
  const open: { mark: { type: string; attrs: PaperAttrs }; close: string }[] = [];
  for (const n of children) {
    const marks = (n.marks ?? [])
      .map(normalMark)
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    let keep = 0;
    while (keep < open.length && keep < marks.length && sameMark(marks[keep]!, open[keep]!.mark)) keep++;
    while (open.length > keep) out += open.pop()!.close;
    for (const m of marks.slice(keep)) {
      const [start, close] = markTags(m);
      out += start;
      open.push({ mark: m, close });
    }
    if (n.type === 'text') out += escapeText(n.text ?? '');
    else if (n.type === 'hardBreak') out += '<br>';
    else if (n.type === 'field') out += renderField(n, fill);
    else if (n.type === 'mention') out += renderMention(n, fill);
    else if (n.type === 'paperNumber') out += renderNumber(fill);
    else if (n.type === 'paperDate' || n.type === 'paperAuthor') out += renderAuto(n, fill);
  }
  while (open.length) out += open.pop()!.close;
  return out;
}

function renderNode(n: PaperNode, fill: FieldFill | undefined): string {
  if (n.type === 'pageBreak') return '<div class="page-break"></div>';
  if (STRUCTURE_CLASS[n.type]) return renderStructure(n, fill);
  if (n.type === 'fieldZone' && fill) {
    const key = fieldKey(n);
    if (key === null || fill.hidden(key)) return '';
  }
  const el = element(n);
  if (!el) return '';
  const children = n.content ?? [];
  const inline = n.type === 'paragraph' || n.type === 'heading';
  return el[0] + (inline ? renderInline(children, fill) : children.map((c) => renderNode(c, fill)).join('')) + el[1];
}

/** HTML of the document's blocks (without a wrapper: the sheet is the caller's). */
export function renderContent(doc: PaperNode, fill?: FieldFill): string {
  return (doc.content ?? []).map((n) => renderNode(n, fill)).join('');
}
