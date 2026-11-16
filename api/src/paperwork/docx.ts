import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
  type ILevelsOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import {
  DEFAULT_FONT_SIZE,
  SHEET_COLORS,
  type TextColor,
} from '../../../shared/editor-schema';
import type { Seal } from './print';

/**
 * A copy of an editor document in Word (DOCX). It is made from the sheet's
 * HTML — a snapshot's or the server's render (print.ts sheetHtml), the same
 * the print shows — so a copy of a frozen document says what its snapshot
 * says. The HTML is only ever render.ts's own: known tags and classes; any
 * other tag is left out, its text stays.
 *
 * The page is the print's: A4, margins 30/10/20/20 mm, Times New Roman 14 pt,
 * 1.5 lines, paragraph indent 10 mm, page numbers at the top from the second
 * page, «Колонтитул» at the foot. A copy of a snapshot ends with a note of
 * where the original is; one of a document not frozen carries its mark
 * («Чернетка»…) at the top of every page.
 */

// ── The sheet's HTML ──────────────────────────────────────────────

type El = {
  tag: string;
  cls: Set<string>;
  attrs: Record<string, string>;
  children: HtmlNode[];
};
type HtmlNode = El | string;

const VOID = new Set(['br', 'hr', 'img', 'meta', 'input']);
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? all;
    const code =
      e[1] === 'x' || e[1] === 'X'
        ? parseInt(e.slice(2), 16)
        : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

const TAG =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*"([^"]*)")?/g;

/** The tree of the sheet's HTML; a closing tag without its opening one is left out. */
export function parseSheet(html: string): El {
  const root: El = { tag: '#root', cls: new Set(), attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1]!;
  const text = (s: string) => {
    if (s) top().children.push(decode(s));
  };
  let at = 0;
  for (const m of html.matchAll(TAG)) {
    text(html.slice(at, m.index));
    at = m.index + m[0].length;
    if (!m[2]) continue; // a comment
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.findLastIndex((e) => e.tag === tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? '').matchAll(ATTR)) {
      attrs[a[1]!.toLowerCase()] = decode(a[2] ?? '');
    }
    const el: El = {
      tag,
      cls: new Set((attrs.class ?? '').split(/\s+/).filter(Boolean)),
      attrs,
      children: [],
    };
    top().children.push(el);
    if (!VOID.has(tag) && !m[0].endsWith('/>')) stack.push(el);
  }
  text(html.slice(at));
  return root;
}

// ── Measures ──────────────────────────────────────────────────────

/** Twips (1/20 pt) in a millimetre. */
const MM = 1440 / 25.4;
const mm = (v: number) => Math.round(v * MM);
const pt = (v: number) => v * 20;

const PAGE = { width: 11906, height: 16838 };
const MARGIN = { top: mm(20), bottom: mm(20), left: mm(30), right: mm(10) };
const TEXT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

const SERIF = 'Times New Roman';
/** ff-sans: e-Ukraine is seldom where Word is. */
const SANS = 'Arial';
const hex = (c: string) => c.replace('#', '');
const INK = hex(SHEET_COLORS.ink);
const GRAY = hex(SHEET_COLORS.gray);

/** 1.5 lines; 1.3 in the header and headings. */
const LINE = 360;
const LINE_TIGHT = 312;

const line = (color = INK, size = 4): IBorderOptions => ({
  style: BorderStyle.SINGLE,
  size,
  color,
});
const NO_LINE: IBorderOptions = {
  style: BorderStyle.NONE,
  size: 0,
  color: 'auto',
};

// ── Walking the sheet ─────────────────────────────────────────────

type RunStyle = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  underline?: boolean;
  /** pt */
  size: number;
  color?: string;
  font?: string;
};

type Ctx = {
  run: RunStyle;
  /** The 10 mm indent of the first line (not in lists, tables and structure). */
  firstLine: boolean;
  /** Left indent of every paragraph, twips (lists, «Затверджую»). */
  left: number;
  line: number;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  /** In «Повторювані рядки»: an empty field is the cell itself, no line. */
  rows: boolean;
  /** Paragraphs of a list item after its first one: no number. */
  list?: { reference: string; level: number; instance: number };
};

type Block = Paragraph | Table;

const INNER: Ctx = {
  run: { size: DEFAULT_FONT_SIZE },
  firstLine: false,
  left: 0,
  line: LINE,
  rows: false,
};

const ALIGN: Record<string, Ctx['align']> = {
  'ta-center': AlignmentType.CENTER,
  'ta-right': AlignmentType.RIGHT,
  'ta-justify': AlignmentType.JUSTIFIED,
};

/** Lines to fill in by hand, mm: a field, a signature, «___» of the day and the month. */
const BLANK_MM: Record<string, number> = {
  'paper-field-blank': 35,
  'paper-sign-line': 35,
  'paper-sign-day': 8,
  'paper-sign-month': 30,
};

/** Run style of a span's classes: fs-*, tc-*, ff-*. */
function styled(run: RunStyle, cls: Set<string>): RunStyle {
  let r = run;
  for (const c of cls) {
    const [kind, v] = [c.slice(0, 3), c.slice(3)];
    if (kind === 'fs-' && Number(v) > 0) r = { ...r, size: Number(v) };
    else if (kind === 'tc-' && v in SHEET_COLORS)
      r = { ...r, color: hex(SHEET_COLORS[v as TextColor]) };
    else if (c === 'ff-sans') r = { ...r, font: SANS };
    else if (c === 'ff-serif') r = { ...r, font: undefined };
  }
  return r;
}

function textRun(text: string, s: RunStyle, extra: IRunOptions = {}) {
  return new TextRun({
    text,
    bold: s.bold,
    italics: s.italics,
    strike: s.strike,
    underline: s.underline ? {} : undefined,
    size: s.size === DEFAULT_FONT_SIZE ? undefined : s.size * 2,
    color: s.color,
    font: s.font,
    ...extra,
  });
}

/** A line to fill in by hand: non-breaking spaces, underlined (a space of Times New Roman is ¼ em). */
function blankRun(lengthMm: number, s: RunStyle) {
  const space = s.size * 0.25 * (25.4 / 72);
  const n = Math.max(2, Math.round(lengthMm / space));
  return textRun(' '.repeat(n), { ...s, underline: true });
}

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'table',
  'div',
  'header',
  'footer',
  'main',
  'section',
]);
const isBlock = (n: HtmlNode) => typeof n !== 'string' && BLOCK_TAGS.has(n.tag);

class Writer {
  /** Lists: ordered ones by their start, bullets — `ul`. */
  private readonly starts = new Set<number>();
  private instance = 0;
  /** A «Розрив сторінки» before the next paragraph. */
  private breakBefore = false;
  /** The number of a list item, for its first paragraph. */
  private number: NonNullable<Ctx['list']> | null = null;

  numbering(): { reference: string; levels: ILevelsOptions[] }[] {
    const levels = (f: (level: number) => Omit<ILevelsOptions, 'level'>) =>
      Array.from({ length: 9 }, (_, level) => ({
        level,
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: {
            indent: { left: mm(10 * (level + 1)), hanging: mm(6) },
          },
        },
        ...f(level),
      }));
    const bullets = ['•', '◦', '▪'];
    return [
      {
        reference: 'ul',
        levels: levels((l) => ({
          format: LevelFormat.BULLET,
          text: bullets[l % bullets.length],
        })),
      },
      ...[...this.starts].map((start) => ({
        reference: `ol-${start}`,
        levels: levels((l) => ({
          format: LevelFormat.DECIMAL,
          text: `%${l + 1}.`,
          start,
        })),
      })),
    ];
  }

  /** Blocks of an element's children; runs of inline ones between blocks make a paragraph. */
  blocks(nodes: HtmlNode[], ctx: Ctx): Block[] {
    const out: Block[] = [];
    let inline: HtmlNode[] = [];
    const flush = () => {
      if (inline.some((n) => typeof n !== 'string' || n.length)) {
        out.push(this.paragraph(inline, ctx, {}));
      }
      inline = [];
    };
    for (const n of nodes) {
      if (!isBlock(n)) {
        inline.push(n);
        continue;
      }
      flush();
      out.push(...this.block(n as El, ctx));
    }
    flush();
    return apart(out);
  }

  private block(el: El, ctx: Ctx): Block[] {
    switch (el.tag) {
      case 'p':
        return [this.p(el, ctx)];
      case 'h1':
      case 'h2':
      case 'h3':
        return [this.heading(el, ctx)];
      case 'ul':
      case 'ol':
        return this.listBlocks(el, ctx);
      case 'table':
        return [...this.unnumbered(), this.table(el, ctx, false)];
    }
    if (el.cls.has('page-break')) {
      this.breakBefore = true;
      return [];
    }
    if (el.cls.has('paper-org')) return this.org(el, ctx);
    if (el.cls.has('paper-approval')) {
      return this.blocks(el.children, {
        ...ctx,
        firstLine: false,
        left: ctx.left + Math.round(TEXT_WIDTH / 2),
      });
    }
    if (el.cls.has('paper-signs'))
      return [...this.unnumbered(), this.signs(el, ctx)];
    if (el.cls.has('paper-table')) {
      return this.blocks(el.children, {
        ...ctx,
        run: { ...ctx.run, size: 12 },
      });
    }
    if (el.cls.has('paper-rows')) {
      return this.blocks(el.children, { ...ctx, rows: true });
    }
    return this.blocks(el.children, ctx);
  }

  /** Options every paragraph takes from where it stands. */
  private para(ctx: Ctx, align: Ctx['align']): IParagraphOptions {
    const centred =
      align === AlignmentType.CENTER || align === AlignmentType.RIGHT;
    const first = ctx.firstLine && !centred && !ctx.list;
    const pageBreakBefore = this.breakBefore || undefined;
    this.breakBefore = false;
    const numbering = this.number;
    this.number = null;
    // A numbered paragraph takes its indent from the list's level.
    if (numbering)
      return {
        alignment: align,
        numbering,
        spacing: ctx.line === LINE ? undefined : { line: ctx.line },
        pageBreakBefore,
      };
    return {
      alignment: align,
      indent:
        ctx.left || first
          ? {
              left: ctx.left || undefined,
              firstLine: first ? mm(10) : undefined,
            }
          : undefined,
      spacing: ctx.line === LINE ? undefined : { line: ctx.line },
      pageBreakBefore,
    };
  }

  private paragraph(
    children: HtmlNode[],
    ctx: Ctx,
    extra: IParagraphOptions,
    cls: Set<string> = new Set(),
  ): Paragraph {
    let align = ctx.align;
    let left = ctx.left;
    for (const c of cls) {
      if (ALIGN[c]) align = ALIGN[c];
      const indent = /^in-(\d)$/.exec(c);
      if (indent) left += mm(5 * Number(indent[1]));
    }
    return new Paragraph({
      ...this.para({ ...ctx, left }, align),
      children: this.runs(children, ctx.run, ctx),
      ...extra,
    });
  }

  private p(el: El, ctx: Ctx): Paragraph {
    const c = el.cls;
    if (c.has('paper-sign')) {
      // A line to sign on, then the name after it.
      const runs = el.children.flatMap((n) =>
        typeof n !== 'string' && n.cls.has('paper-sign-name')
          ? [
              textRun(' '.repeat(2), ctx.run),
              ...this.runs(n.children, ctx.run, ctx),
            ]
          : this.runs([n], ctx.run, ctx),
      );
      return new Paragraph({
        ...this.para({ ...ctx, firstLine: false }, ctx.align),
        spacing: {
          before: pt(6),
          line: ctx.line === LINE ? undefined : ctx.line,
        },
        keepLines: true,
        children: runs,
      });
    }
    const bold =
      c.has('paper-org-institution') ||
      c.has('paper-approval-title') ||
      c.has('paper-table-caption');
    const run = bold ? { ...ctx.run, bold: true } : ctx.run;
    if (c.has('paper-table-caption')) {
      return this.paragraph(
        el.children,
        { ...ctx, run, firstLine: false, align: AlignmentType.CENTER },
        { spacing: { before: pt(6) }, keepNext: true },
      );
    }
    return this.paragraph(el.children, { ...ctx, run }, {}, c);
  }

  private heading(el: El, ctx: Ctx): Paragraph {
    const level = Number(el.tag[1]);
    const heading = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
    ][level - 1];
    return this.paragraph(
      el.children,
      { ...ctx, firstLine: false },
      { heading },
      el.cls,
    );
  }

  /** A list: each item's first paragraph carries the number; nested lists go a level deeper. */
  private listBlocks(el: El, ctx: Ctx): Block[] {
    const out: Block[] = this.unnumbered();
    const level = ctx.list ? Math.min(ctx.list.level + 1, 8) : 0;
    let reference = 'ul';
    if (el.tag === 'ol') {
      const start = Math.max(
        0,
        Math.min(Number(el.attrs.start ?? 1) || 1, 100_000),
      );
      this.starts.add(start);
      reference = `ol-${start}`;
    }
    const list = { reference, level, instance: ++this.instance };
    for (const li of el.children) {
      if (typeof li === 'string' || li.tag !== 'li') continue;
      this.number = list;
      out.push(
        ...this.blocks(li.children, {
          ...ctx,
          firstLine: false,
          left: mm(10 * (level + 1)),
          list,
        }),
      );
      out.push(...this.unnumbered());
    }
    return out;
  }

  /** An item that starts with no paragraph (a table, a list) gets an empty one for its number. */
  private unnumbered(): Paragraph[] {
    if (!this.number) return [];
    return [new Paragraph({ ...this.para(INNER, undefined), children: [] })];
  }

  private table(el: El, ctx: Ctx, borderless: boolean): Table {
    const rows = collect(el, 'tr');
    const first = rows[0];
    const cols = Math.max(
      1,
      first ? cells(first).reduce((n, c) => n + span(c, 'colspan'), 0) : 1,
    );
    const width = Math.floor((TEXT_WIDTH - ctx.left) / cols);
    const border = borderless ? NO_LINE : line();
    const heads = ctx.run.size !== DEFAULT_FONT_SIZE; // an auto table: its first row is the source's columns
    return new Table({
      width: { size: width * cols, type: WidthType.DXA },
      columnWidths: Array.from({ length: cols }, () => width),
      layout: TableLayoutType.FIXED,
      indent: ctx.left ? { size: ctx.left, type: WidthType.DXA } : undefined,
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border,
      },
      rows: (rows.length
        ? rows
        : [{ tag: 'tr', cls: new Set(), attrs: {}, children: [] } as El]
      ).map(
        (tr, i) =>
          new TableRow({
            tableHeader:
              heads && i === 0 && cells(tr).every((c) => c.tag === 'th')
                ? true
                : undefined,
            cantSplit: borderless || undefined,
            children: (cells(tr).length
              ? cells(tr)
              : [{ tag: 'td', cls: new Set(), attrs: {}, children: [] } as El]
            ).map((td) => this.cell(td, ctx, borderless)),
          }),
      ),
    });
  }

  private cell(td: El, ctx: Ctx, borderless: boolean): TableCell {
    const note =
      td.cls.has('paper-table-more') || td.cls.has('paper-table-none');
    const run: RunStyle = {
      ...ctx.run,
      bold: ctx.run.bold || td.tag === 'th' || undefined,
      italics: ctx.run.italics || note || undefined,
      color: note ? GRAY : ctx.run.color,
    };
    const inner: Ctx = {
      ...ctx,
      run,
      firstLine: false,
      left: 0,
      list: undefined,
      align: note ? AlignmentType.CENTER : undefined,
    };
    const children = this.blocks(td.children, inner);
    return new TableCell({
      columnSpan: span(td, 'colspan') > 1 ? span(td, 'colspan') : undefined,
      rowSpan: span(td, 'rowspan') > 1 ? span(td, 'rowspan') : undefined,
      margins: borderless
        ? { top: pt(18), bottom: 0, left: 0, right: mm(5) }
        : { top: mm(1), bottom: mm(1), left: mm(2), right: mm(2) },
      children: closed(children),
    });
  }

  /** «Шапка»: institution and group in the centre, 12 pt, a line under them. */
  private org(el: El, ctx: Ctx): Block[] {
    const inner: Ctx = {
      ...ctx,
      run: { ...ctx.run, size: 12 },
      firstLine: false,
      line: LINE_TIGHT,
      align: AlignmentType.CENTER,
    };
    const ps = el.children.filter(
      (n): n is El => typeof n !== 'string' && n.tag === 'p',
    );
    return ps.map((p, i) =>
      i === ps.length - 1
        ? this.paragraph(
            p.children,
            {
              ...inner,
              run: p.cls.has('paper-org-institution')
                ? { ...inner.run, bold: true }
                : inner.run,
            },
            {
              border: { bottom: { ...line(), space: 4 } },
              spacing: { after: pt(12), line: LINE_TIGHT },
            },
          )
        : this.p(p, inner),
    );
  }

  /** «Блок підписів»: one or two columns side by side, a table without lines. */
  private signs(el: El, ctx: Ctx): Table {
    const cols = el.children.filter(
      (n): n is El => typeof n !== 'string' && n.cls.has('paper-signs-col'),
    );
    const row: El = {
      tag: 'tr',
      cls: new Set(),
      attrs: {},
      children: cols.map((c) => ({ ...c, tag: 'td', cls: new Set<string>() })),
    };
    return this.table(
      { tag: 'table', cls: new Set(), attrs: {}, children: [row] },
      ctx,
      true,
    );
  }

  /** Runs of inline content with the marks and classes around them. */
  private runs(nodes: HtmlNode[], s: RunStyle, ctx: Ctx): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const n of nodes) {
      if (typeof n === 'string') {
        if (n) out.push(textRun(n.replace(/[\r\n\t]+/g, ' '), s));
        continue;
      }
      if (n.tag === 'br') {
        out.push(textRun('', s, { break: 1 }));
        continue;
      }
      const blank = [...n.cls].find((c) => BLANK_MM[c]);
      if (blank) {
        if (!(ctx.rows && blank === 'paper-field-blank'))
          out.push(blankRun(BLANK_MM[blank]!, s));
        continue;
      }
      const inner =
        n.tag === 'strong' || n.tag === 'b'
          ? { ...s, bold: true }
          : n.tag === 'em' || n.tag === 'i'
            ? { ...s, italics: true }
            : n.tag === 's'
              ? { ...s, strike: true }
              : n.tag === 'u'
                ? { ...s, underline: true }
                : styled(s, n.cls);
      // A block inside a line (none comes from render.ts): its text only.
      out.push(...this.runs(n.children, inner, ctx));
    }
    return out;
  }
}

/** A thin paragraph: Word merges two tables that touch, and a cell or a document may not end with a table. */
const gap = () =>
  new Paragraph({
    spacing: { line: pt(6), lineRule: LineRuleType.EXACT },
    children: [],
  });

/** Tables kept apart: a thin paragraph between two that touch. */
function apart(blocks: Block[]): Block[] {
  return blocks.flatMap((b, i) =>
    b instanceof Table && blocks[i + 1] instanceof Table ? [b, gap()] : [b],
  );
}

/** Ends with a paragraph, as a cell and a document must. */
function closed(blocks: Block[]): Block[] {
  if (!blocks.length) return [new Paragraph({ children: [] })];
  return blocks[blocks.length - 1] instanceof Paragraph
    ? blocks
    : [...blocks, gap()];
}

function collect(el: El, tag: string): El[] {
  const out: El[] = [];
  for (const n of el.children) {
    if (typeof n === 'string') continue;
    if (n.tag === tag) out.push(n);
    else if (n.tag === 'tbody' || n.tag === 'thead' || n.tag === 'tfoot')
      out.push(...collect(n, tag));
  }
  return out;
}

const cells = (tr: El) =>
  tr.children.filter(
    (n): n is El => typeof n !== 'string' && (n.tag === 'td' || n.tag === 'th'),
  );

function span(td: El, name: 'colspan' | 'rowspan'): number {
  const v = Number(td.attrs[name] ?? 1);
  return Number.isInteger(v) && v >= 1 && v <= 500 ? v : 1;
}

// ── The document ──────────────────────────────────────────────────

/** A copy of a snapshot: where its original is (instead of the print's seal). */
function copyNote(seal: Seal): Paragraph[] {
  const run: RunStyle = { size: 9, color: GRAY };
  const p = (children: ParagraphChild[], first = false) =>
    new Paragraph({
      spacing: { before: first ? mm(10) : 0, line: 240 },
      keepNext: first || undefined,
      children,
    });
  return [
    p(
      [
        textRun(
          `Копія документа, зафіксованого ${seal.frozenOn}. Справжність перевіряють за оригіналом`,
          run,
        ),
        textRun(seal.url ? ':' : '.', run),
      ],
      true,
    ),
    ...(seal.url
      ? [
          p([
            new ExternalHyperlink({
              link: seal.url,
              children: [textRun(seal.url, { ...run, underline: true })],
            }),
          ]),
        ]
      : []),
    p([
      textRun(`SHA-256: ${seal.sha256}`, {
        ...run,
        font: 'Courier New',
        size: 8,
      }),
    ]),
  ];
}

/** Top of the page: the mark of a document not final and, from the second page, the page's number. */
function header(mark: string | null, numbered: boolean): Header {
  const children: Paragraph[] = [];
  if (mark) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { line: 240 },
        children: [
          textRun(
            mark.toUpperCase(),
            { size: 10, color: GRAY, bold: true },
            { characterSpacing: 40 },
          ),
        ],
      }),
    );
  }
  if (numbered) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 240 },
        children: [new TextRun({ children: [PageNumber.CURRENT], size: 24 })],
      }),
    );
  }
  return new Header({ children });
}

function footer(text: string): Footer {
  return new Footer({
    children: text
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { line: 240 },
            children: [textRun(text, { size: 10 })],
          }),
        ]
      : [],
  });
}

/** The DOCX of a document's sheet. */
export async function paperDocx(paper: {
  title: string;
  /** The sheet (sheetHtml or a snapshot's). */
  sheet: string;
  /** «Колонтитул» of the content. */
  footer: string;
  /** The snapshot the sheet is; none — not frozen. */
  seal?: Seal | null;
  /** «Чернетка», «Скасовано»…: at the top of every page; none — a clean copy. */
  mark?: string | null;
}): Promise<Buffer> {
  const writer = new Writer();
  const root = parseSheet(paper.sheet);
  const ctx: Ctx = {
    run: { size: DEFAULT_FONT_SIZE },
    firstLine: true,
    left: 0,
    line: LINE,
    rows: false,
  };
  const children = closed([
    ...writer.blocks(root.children, ctx),
    ...(paper.seal ? copyNote(paper.seal) : []),
  ]);
  const heading = (size: number, italics = false) => ({
    run: { font: SERIF, size: size * 2, bold: true, italics, color: INK },
    paragraph: {
      spacing: {
        before: pt(12),
        after: pt(6),
        line: LINE_TIGHT,
        lineRule: LineRuleType.AUTO,
      },
      keepNext: true,
    },
  });
  const doc = new Document({
    title: paper.title,
    creator: 'DigiComp HUB',
    styles: {
      default: {
        document: {
          run: {
            font: SERIF,
            size: DEFAULT_FONT_SIZE * 2,
            color: INK,
            language: { value: 'uk-UA' },
          },
          paragraph: {
            spacing: {
              line: LINE,
              lineRule: LineRuleType.AUTO,
              before: 0,
              after: 0,
            },
          },
        },
        heading1: heading(16),
        heading2: heading(14),
        heading3: heading(14, true),
      },
    },
    numbering: { config: writer.numbering() },
    sections: [
      {
        properties: {
          titlePage: true,
          page: {
            size: PAGE,
            margin: { ...MARGIN, header: mm(10), footer: mm(10) },
          },
        },
        headers: {
          first: header(paper.mark ?? null, false),
          default: header(paper.mark ?? null, true),
        },
        footers: { first: footer(paper.footer), default: footer(paper.footer) },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** The file's name: «<номер> <назва>.docx», without characters a file system forbids. */
export function docxFileName(title: string, number: string | null): string {
  const name = `${number ? `${number} ` : ''}${title}`
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${name || 'Документ'}.docx`;
}
