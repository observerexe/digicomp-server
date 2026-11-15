import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SHEET_COLORS, type PaperContent } from '../../../shared/editor-schema';
import {
  renderContent,
  type FieldFill,
} from '../../../shared/editor-schema/render';

/**
 * Print page of an editor document: an A4 sheet by ДСТУ 4163:2020
 * (margins left 30, right 10, top and bottom 20 mm; page numbers at the top
 * centre from the second page). The sheet's look is the editor's own
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

/** On screen: a sheet on a desk; in print: the sheet alone, margins from @page. */
const STYLE = `
@page { size: A4; margin: 20mm 10mm 20mm 30mm; @top-center { content: counter(page); font: 12pt ${SERIF_FONT}; color: ${SHEET_COLORS.ink}; } }
@page :first { @top-center { content: none; } }
@font-face { font-family: 'e-Ukraine'; src: url('/fonts/e-Ukraine-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'e-Ukraine'; src: url('/fonts/e-Ukraine-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }
:root { ${vars} --font-body: ${SANS_FONT}; }
${PAPER_CSS}
html { background: color-mix(in srgb, var(--sheet-ink) 6%, var(--sheet-paper)); }
body { margin: 0; padding: 16px 0 32px; }
.hint { box-sizing: border-box; width: 210mm; margin: 0 auto 12px; color: var(--sheet-gray); font: 13px/1.4 var(--font-body); }
.paper { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm 10mm 20mm 30mm; box-shadow: 0 1px 4px color-mix(in srgb, var(--sheet-ink) 25%, transparent); }
.paper .org { margin-bottom: 12pt; padding-bottom: 4pt; border-bottom: 1px solid var(--sheet-ink); font-size: 12pt; line-height: 1.3; text-align: center; }
.paper .org p { text-indent: 0; }
.paper .org-institution { font-weight: 700; }
@media print {
  html { background: none; }
  body { padding: 0; }
  .hint { display: none; }
  .paper { width: auto; min-height: 0; padding: 0; box-shadow: none; }
}
`;

/** Hash for the page CSP: the only inline content allowed is this style. */
const STYLE_HASH =
  'sha256-' + createHash('sha256').update(STYLE).digest('base64');

/** No scripts, nothing from elsewhere; fonts from the app itself. */
export const PRINT_CSP = [
  "default-src 'none'",
  `style-src '${STYLE_HASH}'`,
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function esc(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

export type PrintRequisites = { institution: string; groupName: string };

/** The header from «Реквізити»: institution, group; nothing if both are empty. */
function orgHeader({ institution, groupName }: PrintRequisites) {
  const lines = [
    institution.trim() &&
      `<p class="org-institution">${esc(institution.trim())}</p>`,
    groupName.trim() && `<p class="org-group">${esc(groupName.trim())}</p>`,
  ].filter(Boolean);
  return lines.length ? `<header class="org">${lines.join('')}</header>` : '';
}

/** A document without values: every field an empty line. */
const NO_VALUES: FieldFill = {
  text: () => null,
  hidden: () => false,
  title: () => null,
};

export function paperPrintHtml(paper: {
  title: string;
  content: PaperContent;
  requisites: PrintRequisites;
  /** Values of the template's fields; without it — fields as empty lines. */
  fill?: FieldFill;
}) {
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>${esc(paper.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<p class="hint">Щоб роздрукувати або зберегти PDF: Ctrl+P (на телефоні — «Поділитися» → «Друк»). У вікні друку вимкніть колонтитули, щоб браузер не додав свою адресу й дату. Ця підказка не друкується.</p>
<main class="paper">${orgHeader(paper.requisites)}${renderContent(paper.content, paper.fill ?? NO_VALUES)}</main>
</body>
</html>
`;
}
