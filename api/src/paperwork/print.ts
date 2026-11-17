import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { encode } from 'uqr';
import { SHEET_COLORS, type PaperContent } from '../../../shared/editor-schema';
import {
  renderContent,
  type FieldFill,
} from '../../../shared/editor-schema/render';

/**
 * Print page of an editor document: an A4 sheet by ДСТУ 4163:2020
 * (margins left 30, right 10, top and bottom 20 mm; page numbers at the top
 * centre from the second page). The header, «Затверджую» and signatures are
 * blocks of the text itself (requisites come in `fill.info`). The sheet's look is the editor's own
 * (shared/editor-schema/paper.css, copied next to the build by nest-cli.json).
 *
 * The sheet (`<main class="paper">`) is what a snapshot keeps and hashes;
 * the page around it adds the seal of a snapshot (QR, SHA-256) or the
 * watermark of a document that is not frozen (or cancelled).
 */

const PAPER_CSS = readFileSync(
  join(__dirname, '../../../shared/editor-schema/paper.css'),
  'utf8',
);

/** The sans font of the sheet (ff-sans): tokens.json font.body + fallback. */
export const SANS_FONT = "'e-Ukraine', system-ui, sans-serif";

const SERIF_FONT = "'Times New Roman', 'Liberation Serif', serif";

const vars = Object.entries(SHEET_COLORS)
  .map(([k, v]) => `--sheet-${k}: ${v};`)
  .join(' ');

/** CSS text in a string: quotes, backslashes and `<` (no `</style>`) escaped. */
function cssString(s: string) {
  return `"${s.replace(/[\\"<]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

/**
 * On screen: a sheet on a desk; in print: the sheet alone, margins from
 * @page; the footer («Колонтитул») at the foot of every page.
 */
function pageStyle(footer: string) {
  const foot = footer
    ? ` @bottom-center { content: ${cssString(footer)}; font: 10pt ${SERIF_FONT}; color: ${SHEET_COLORS.ink}; }`
    : '';
  return `
@page { size: A4; margin: 20mm 10mm 20mm 30mm; @top-center { content: counter(page); font: 12pt ${SERIF_FONT}; color: ${SHEET_COLORS.ink}; }${foot} }
@page :first { @top-center { content: none; } }
@font-face { font-family: 'e-Ukraine'; src: url('/fonts/e-Ukraine-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'e-Ukraine'; src: url('/fonts/e-Ukraine-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
:root { ${vars} --font-body: ${SANS_FONT}; }
${PAPER_CSS}
html { background: color-mix(in srgb, var(--sheet-ink) 6%, var(--sheet-paper)); }
body { margin: 0; padding: 16px 0 32px; }
.hint { box-sizing: border-box; width: 210mm; margin: 0 auto 12px; color: var(--sheet-gray); font: 13px/1.4 var(--font-body); }
.hint a { color: var(--sheet-blue); }
.page { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm 10mm 20mm 30mm; background: var(--sheet-paper); box-shadow: 0 1px 4px color-mix(in srgb, var(--sheet-ink) 25%, transparent); }
.seal { display: flex; gap: 4mm; align-items: center; margin-top: 10mm; break-inside: avoid; color: var(--sheet-ink); font: 9pt/1.35 ${SERIF_FONT}; }
.seal svg { flex: none; width: 22mm; height: 22mm; }
.seal p { margin: 0; }
.seal-code { font-family: monospace; font-size: 8pt; word-break: break-all; }
.watermark { position: fixed; top: 50%; left: 50%; z-index: 1; transform: translate(-50%, -50%) rotate(-35deg); color: color-mix(in srgb, var(--sheet-gray) 20%, transparent); font: 700 64pt ${SERIF_FONT}; text-transform: uppercase; white-space: nowrap; pointer-events: none; }
@media print {
  html { background: none; }
  body { padding: 0; }
  .hint { display: none; }
  .page { width: auto; min-height: 0; padding: 0; box-shadow: none; }
}
`;
}

/**
 * No scripts, nothing from elsewhere; fonts and images from the app itself. The only
 * inline content allowed is the page's own style (by its hash).
 */
export function printCsp(style: string) {
  const hash = 'sha256-' + createHash('sha256').update(style).digest('base64');
  return [
    "default-src 'none'",
    `style-src '${hash}'`,
    "font-src 'self'",
    // «Зображення» of the document: the API's own, for who sees it.
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function esc(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

/** A document without values: every field and name an empty line. */
const NO_VALUES: FieldFill = {
  text: () => null,
  hidden: () => false,
  holds: () => false,
  title: () => null,
  number: null,
  info: {
    institution: '',
    groupName: '',
    signerPosition: '',
    person: () => null,
    date: null,
    year: '',
  },
};

/**
 * The sheet of a document: its content with the values of fields and
 * requisites (without `fill` — fields as empty lines). A snapshot's sheet
 * names the document and the snapshot (`mark`): two documents saying the
 * same never share a hash.
 */
export function sheetHtml(
  content: PaperContent,
  fill: FieldFill = NO_VALUES,
  mark?: { paperId: string; n: number },
): string {
  const data = mark
    ? ` data-paper="${esc(mark.paperId)}" data-snapshot="${mark.n}"`
    : '';
  return `<main class="paper"${data}>${renderContent(content, fill)}</main>`;
}

/** SHA-256 of a sheet, hex: what the seal and the check page show. */
export function sheetHash(sheet: string): string {
  return createHash('sha256').update(sheet, 'utf8').digest('hex');
}

/** A QR code as inline SVG (no style attribute: the CSP stays strict). */
export function qrSvg(value: string): string {
  const { data } = encode(value, { ecc: 'M', border: 0 });
  const n = data.length;
  let d = '';
  data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR-код перевірки"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** The seal of a snapshot under the sheet: QR to the check page and the hash. */
export type Seal = {
  sha256: string;
  /** «15.11.2026» */
  frozenOn: string;
  /** The check page; null — no PUBLIC_ORIGIN: the hash alone. */
  url: string | null;
};

function sealHtml(seal: Seal) {
  const how = seal.url
    ? 'Перевірити справжність — QR-код або код на сторінці перевірки.'
    : '';
  return `<footer class="seal">${seal.url ? qrSvg(seal.url) : ''}<p>Документ зафіксовано ${esc(seal.frozenOn)}. ${how}<br><span class="seal-code">SHA-256: ${esc(seal.sha256)}</span></p></footer>`;
}

/** The print page and its CSP (the hash of its style). */
export function paperPrintHtml(paper: {
  title: string;
  /** The sheet (sheetHtml or a snapshot's). */
  sheet: string;
  /** «Колонтитул» of the content: at the foot of every page. */
  footer: string;
  /** A snapshot's seal; none — not frozen. */
  seal?: Seal | null;
  /** Across every page: «Чернетка», «Скасовано»…; none — a clean print. */
  watermark?: string | null;
  /** The address of the same sheet as DOCX (a link in the hint); none — no link. */
  docx?: string | null;
}): { html: string; csp: string } {
  const style = pageStyle(paper.footer);
  const mark = paper.watermark
    ? `<div class="watermark" aria-hidden="true">${esc(paper.watermark)}</div>\n`
    : '';
  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>${esc(paper.title)}</title>
<style>${style}</style>
</head>
<body>
<p class="hint">Щоб роздрукувати або зберегти PDF: Ctrl+P (на телефоні — «Поділитися» → «Друк»). У вікні друку вимкніть колонтитули браузера, щоб він не додав свою адресу й дату. Ця підказка не друкується.${paper.docx ? ` <a href="${esc(paper.docx)}" download>Завантажити копію DOCX</a>` : ''}</p>
${mark}<div class="page">${paper.sheet}${paper.seal ? sealHtml(paper.seal) : ''}</div>
</body>
</html>
`;
  return { html, csp: printCsp(style) };
}
