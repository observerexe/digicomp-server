/**
 * Drawn signatures: strokes of points, not a picture. The SVG is drawn here
 * (a path with attributes, no `style`) — by the server for the print and by
 * the editor for its sheet, the same — so nothing a browser sends gets into
 * a page as markup and the print's CSP stays strict. The pad that draws
 * (web/src/editor/SignaturePad.tsx) keeps to the same field and limits.
 */
import { momentText } from './fields';

/** Strokes, each `[x0, y0, x1, y1, …]`: whole numbers on a SIGN_WIDTH × SIGN_HEIGHT field. */
export type Strokes = number[][];

/** The field a signature is drawn on (3 : 1, as the line it stands over). */
export const SIGN_WIDTH = 1500;
export const SIGN_HEIGHT = 500;

/** At most: strokes, points in a stroke, points in all (about 60 KB of JSON). */
export const SIGN_LIMITS = { strokes: 100, strokePoints: 1000, points: 6000 };

/** Strokes within the field and the limits; at least one point. */
export function strokesValid(v: unknown): v is Strokes {
  if (!Array.isArray(v) || v.length < 1 || v.length > SIGN_LIMITS.strokes) return false;
  let points = 0;
  for (const s of v) {
    if (!Array.isArray(s) || s.length < 2 || s.length % 2 !== 0) return false;
    if (s.length / 2 > SIGN_LIMITS.strokePoints) return false;
    points += s.length / 2;
    for (let i = 0; i < s.length; i++) {
      const n: unknown = s[i];
      const max = i % 2 === 0 ? SIGN_WIDTH : SIGN_HEIGHT;
      if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > max) return false;
    }
  }
  return points <= SIGN_LIMITS.points;
}

/** The path of strokes: round lines, a single point — a dot. */
export function strokesPath(strokes: Strokes): string {
  return strokes
    .map((s) => {
      let path = `M${s[0]} ${s[1]}`;
      for (let i = 2; i < s.length; i += 2) path += `L${s[i]} ${s[i + 1]}`;
      return s.length === 2 ? `${path}l0 0` : path;
    })
    .join('');
}

/** The pen's width on the field: the pad draws with it too. */
export const SIGN_PEN = 12;

/** A signature as inline SVG: one path. Only valid strokes (strokesValid): numbers, nothing to escape. */
export function signatureSvg(strokes: Strokes): string {
  return `<svg class="paper-signature" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIGN_WIDTH} ${SIGN_HEIGHT}" role="img" aria-label="Підпис"><path d="${strokesPath(strokes)}" fill="none" stroke="currentColor" stroke-width="${SIGN_PEN}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** How a sheet names a drawn signature: in the print, the DOCX and the editor. */
export const SIGNED_IN = 'Підписано в DigiComp HUB';

/** Under a signature, small: «Підписано в DigiComp HUB 16.11.2026, 14:32» (Kyiv). */
export function signedNote(at: Date | string): string {
  return `${SIGNED_IN} ${momentText(at)}`;
}

/** A signature on a line of a sheet: the line's index (render.ts signLines order). */
export type SheetSignature = {
  row: number;
  strokes: Strokes;
  /** Under the line, small: signedNote, or what the DOCX says. */
  note: string;
};

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A line to sign on of a sheet (render.ts signLine), up to its paragraph's end. */
const SIGN_LINE = /<p class="paper-sign"><span class="paper-sign-line"><\/span>([\s\S]*?)<\/p>/g;

/**
 * A sheet with its drawn signatures: each over its line, its note under it.
 * `first` — the row of the HTML's first line (the editor draws one block at
 * a time). A snapshot itself (and its hash) is not changed: this is what
 * the print, the DOCX and the editor show.
 */
export function signedSheet(sheet: string, signatures: SheetSignature[], first = 0) {
  if (!signatures.length) return sheet;
  const byRow = new Map(signatures.map((s) => [s.row, s]));
  let row = first;
  return sheet.replace(SIGN_LINE, (line: string, rest: string) => {
    const s = byRow.get(row++);
    return s ? `<p class="paper-sign"><span class="paper-sign-line">${signatureSvg(s.strokes)}</span>${rest}</p><p class="paper-signed-note">${esc(s.note)}</p>` : line;
  });
}
