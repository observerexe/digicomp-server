/**
 * Document content → HTML, the same HTML the web editor gives
 * (web/src/editor/render.test.ts compares it with TipTap's generateHTML).
 * The API prints with it; the look is paper.css.
 *
 * Only what the description allows gets out: known nodes and marks,
 * attributes as format classes or checked numbers, escaped text.
 */
import { conditionOf, RECORD_MISSING, repeatParts } from './fields';
import { formatClass, MARKS, NODES, SIGNER_AUTHOR, SIGNER_ORG, tableKey, type AutoTableData, type PaperAttrs, type PaperMark, type PaperNode } from './index';

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
  /** A conditional block's condition holds: the `enum` field `field` holds `value`. */
  holds(field: string, value: string): boolean;
  /**
   * «Повторювані рядки» of the `rows` field `key`: a fill for each row (its
   * `text` gives the cells; columns are printed as the rows are); none — one
   * row to fill in by hand.
   */
  rows?(key: string): FieldFill[];
  /** A fill of a row: its number for «№ рядка» (from 1); none — not a row, or one to fill in by hand. */
  row?: number | null;
  /** «Авто-таблиця» of `source` for the field `field` (see tableKey); none — nothing to print. */
  table?(source: string, field: string): AutoTableData | null;
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
      const lines = [
        info.institution.trim() && p('paper-org-institution', escapeText(info.institution.trim())),
        info.groupName.trim() && p('paper-org-group', escapeText(info.groupName.trim())),
      ];
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
        ? (['leftLabel', 'leftSigner', 'rightLabel', 'rightSigner'] as const).map((k) => [
            `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
            escapeAttr((nodeAttr(n, k) as string | null) ?? ''),
          ])
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
      return [
        tag('div', [
          ['class', 'paper-zone'],
          ['data-field', fieldKey(n)],
        ]),
        '</div>',
      ];
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
  if (!fill)
    return (
      tag('span', [
        ['class', 'paper-field'],
        ['data-field', key],
      ]) + '</span>'
    );
  if (key === null || fill.hidden(key)) return '';
  const text = fill.text(key);
  return text === null ? BLANK : `<span class="paper-field">${escapeText(text)}</span>`;
}

/** A reference: the title of the record in the print; in the editor's HTML — only what it points to. */
function renderMention(n: PaperNode, fill: FieldFill | undefined): string {
  const type = nodeAttr(n, 'type') as string | null;
  const id = nodeAttr(n, 'id') as string | null;
  // Type and id match RECORD_TYPE_KEY and RECORD_ID: nothing to escape.
  if (!fill)
    return (
      tag('span', [
        ['class', 'paper-ref'],
        ['data-ref-type', type],
        ['data-ref-id', id],
      ]) + '</span>'
    );
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

/** «№ рядка»: the row's number in the print; in the editor's HTML — an empty placeholder. */
function renderRowNumber(fill: FieldFill | undefined): string {
  if (!fill) return '<span class="paper-row-number"></span>';
  return fill.row ? String(fill.row) : '';
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
    else if (n.type === 'rowNumber') out += renderRowNumber(fill);
  }
  while (open.length) out += open.pop()!.close;
  return out;
}

/** A conditional block: in the editor's HTML — its element with the condition; in the print — its blocks, or nothing while the condition does not hold. */
function renderConditional(n: PaperNode, fill: FieldFill | undefined): string {
  const children = (n.content ?? []).map((c) => renderNode(c, fill)).join('');
  if (fill) {
    const c = conditionOf(n);
    return c && fill.holds(c.field, c.value) ? children : '';
  }
  // The field's key matches FIELD_KEY: nothing to escape.
  const field = nodeAttr(n, 'field') as string | null;
  const value = nodeAttr(n, 'value') as string | null;
  return (
    tag('div', [
      ['class', 'paper-if'],
      ['data-field', field],
      ['data-value', value === null ? null : escapeAttr(value)],
    ]) +
    children +
    '</div>'
  );
}

/**
 * «Повторювані рядки»: in the editor's HTML — its element and the table as it is;
 * in the print — the header rows, then the last row once a row of the field
 * (none — once, empty), or nothing when the field is not printed.
 */
function renderRepeat(n: PaperNode, fill: FieldFill | undefined): string {
  const key = fieldKey(n);
  if (!fill)
    return (
      tag('div', [
        ['class', 'paper-rows'],
        ['data-field', key],
      ]) +
      (n.content ?? []).map((c) => renderNode(c, fill)).join('') +
      '</div>'
    );
  if (key === null || fill.hidden(key)) return '';
  const { table, header, row } = repeatParts(n);
  if (!table) return '';
  const rows = fill.rows?.(key) ?? [];
  const body = row ? (rows.length ? rows : [{ ...fill, text: () => null, hidden: () => false, row: null }]).map((f) => renderNode(row, f)).join('') : '';
  return `<div class="paper-rows"><table><tbody>${header.map((r) => renderNode(r, fill)).join('')}${body}</tbody></table></div>`;
}

/** Words for «і ще N»: «рядок», «рядки», «рядків». */
function rowWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'раніший рядок';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'раніші рядки';
  return 'раніших рядків';
}

/**
 * What an auto table holds (the editor draws the same inside its own
 * element): the caption, the source's columns, then its rows — none yet
 * (its field is empty): one empty row; none at all: «Записів немає».
 */
export function autoTableInner(t: AutoTableData): string {
  const cols = t.columns.length || 1;
  const wide = (cls: string, text: string) => `<tr><td colspan="${cols}" class="${cls}">${escapeText(text)}</td></tr>`;
  const head = `<tr>${t.columns.map((c) => `<th>${escapeText(c)}</th>`).join('')}</tr>`;
  const more = t.more > 0 ? wide('paper-table-more', `… і ще ${t.more} ${rowWord(t.more)}`) : '';
  const rows =
    t.rows === null
      ? `<tr>${t.columns.map(() => '<td></td>').join('')}</tr>`
      : t.rows.length === 0
        ? wide('paper-table-none', 'Записів немає')
        : t.rows.map((r) => `<tr>${t.columns.map((_, i) => `<td>${escapeText(r[i] ?? '')}</td>`).join('')}</tr>`).join('');
  const caption = t.caption ? p('paper-table-caption', escapeText(t.caption)) : '';
  return `${caption}<table><tbody>${head}${more}${rows}</tbody></table>`;
}

/** «Авто-таблиця»: in the editor's HTML — its element with the source and the field; in the print — the table (see autoTableInner). */
function renderAutoTable(n: PaperNode, fill: FieldFill | undefined): string {
  // Source and field match TABLE_SOURCE_KEY and FIELD_KEY: nothing to escape.
  const source = nodeAttr(n, 'source') as string | null;
  const field = nodeAttr(n, 'field') as string | null;
  if (!fill)
    return (
      tag('div', [
        ['class', 'paper-table'],
        ['data-source', source],
        ['data-field', field],
      ]) + '</div>'
    );
  const t = source && field ? (fill.table?.(source, field) ?? null) : null;
  return t ? `<div class="paper-table">${autoTableInner(t)}</div>` : '';
}

/** The data of an auto table in `tables` (see tableKey); null — none. */
export function tableOf(tables: Record<string, AutoTableData>, n: PaperNode): AutoTableData | null {
  const source = nodeAttr(n, 'source') as string | null;
  const field = nodeAttr(n, 'field') as string | null;
  return (source && field && tables[tableKey(source, field)]) || null;
}

function renderNode(n: PaperNode, fill: FieldFill | undefined): string {
  if (n.type === 'pageBreak') return '<div class="page-break"></div>';
  if (n.type === 'autoTable') return renderAutoTable(n, fill);
  if (n.type === 'conditional') return renderConditional(n, fill);
  if (n.type === 'repeat') return renderRepeat(n, fill);
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
