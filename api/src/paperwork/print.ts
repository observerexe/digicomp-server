import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SHEET_COLORS, type PaperContent } from '../../../shared/editor-schema';
import {
  footerText,
  renderContent,
  type FieldFill,
} from '../../../shared/editor-schema/render';

/**
 * Print page of an editor document: an A4 sheet by ДСТУ 4163:2020
 * (margins left 30, right 10, top and bottom 20 mm; page numbers at the top
 * centre from the second page). The header, «Затверджую» and signatures are
 * blocks of the text itself (requisites come in `fill.info`). The sheet's look is the editor's own
 * (shared/editor-schema/paper.css, copied next to the build by nest-cli.json).
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
.paper { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm 10mm 20mm 30mm; box-shadow: 0 1px 4px color-mix(in srgb, var(--sheet-ink) 25%, transparent); }
@media print {
  html { background: none; }
  body { padding: 0; }
  .hint { display: none; }
  .paper { width: auto; min-height: 0; padding: 0; box-shadow: none; }
}
`;
}

/**
 * No scripts, nothing from elsewhere; fonts from the app itself. The only
 * inline content allowed is the page's own style (by its hash).
 */
export function printCsp(style: string) {
  const hash = 'sha256-' + createHash('sha256').update(style).digest('base64');
  return [
    "default-src 'none'",
    `style-src '${hash}'`,
    "font-src 'self'",
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

/** The print page and its CSP (the hash of its style). */
export function paperPrintHtml(paper: {
  title: string;
  content: PaperContent;
  /** Values of the template's fields, requisites; without it — fields as empty lines. */
  fill?: FieldFill;
}): { html: string; csp: string } {
  const style = pageStyle(footerText(paper.content));
  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>${esc(paper.title)}</title>
<style>${style}</style>
</head>
<body>
<p class="hint">Щоб роздрукувати або зберегти PDF: Ctrl+P (на телефоні — «Поділитися» → «Друк»). У вікні друку вимкніть колонтитули браузера, щоб він не додав свою адресу й дату. Ця підказка не друкується.</p>
<main class="paper">${renderContent(paper.content, paper.fill ?? NO_VALUES)}</main>
</body>
</html>
`;
  return { html, csp: printCsp(style) };
}
