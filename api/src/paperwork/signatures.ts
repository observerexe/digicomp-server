import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * Drawn signatures: strokes of points, not a picture. The server draws the
 * SVG itself (a path with attributes, no `style`), so nothing a browser
 * sends gets into a page as markup and the print's CSP stays strict.
 */

/** Strokes, each `[x0, y0, x1, y1, …]`: whole numbers on a SIGN_WIDTH × SIGN_HEIGHT field. */
export type Strokes = number[][];

/** The field a signature is drawn on (3 : 1, as the line it stands over). */
export const SIGN_WIDTH = 1500;
export const SIGN_HEIGHT = 500;

/** At most: strokes, points in a stroke, points in all (about 60 KB of JSON). */
export const SIGN_LIMITS = { strokes: 100, strokePoints: 1000, points: 6000 };

/** Strokes within the field and the limits; at least one point. */
export function strokesValid(v: unknown): v is Strokes {
  if (!Array.isArray(v) || v.length < 1 || v.length > SIGN_LIMITS.strokes)
    return false;
  let points = 0;
  for (const s of v) {
    if (!Array.isArray(s) || s.length < 2 || s.length % 2 !== 0) return false;
    if (s.length / 2 > SIGN_LIMITS.strokePoints) return false;
    points += s.length / 2;
    for (let i = 0; i < s.length; i++) {
      const n: unknown = s[i];
      const max = i % 2 === 0 ? SIGN_WIDTH : SIGN_HEIGHT;
      if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > max)
        return false;
    }
  }
  return points <= SIGN_LIMITS.points;
}

/** DTO check: see strokesValid. */
export function IsStrokes(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isStrokes',
      validator: {
        validate: (v) => strokesValid(v),
        defaultMessage: () =>
          `$property must be 1–${SIGN_LIMITS.strokes} strokes of whole points within ${SIGN_WIDTH}×${SIGN_HEIGHT}, up to ${SIGN_LIMITS.strokePoints} points each, ${SIGN_LIMITS.points} in all`,
      },
    },
    options,
  );
}

/** A signature as inline SVG: one path of round lines (a single point — a dot). */
export function signatureSvg(strokes: Strokes): string {
  const d = strokes
    .map((s) => {
      let path = `M${s[0]} ${s[1]}`;
      for (let i = 2; i < s.length; i += 2) path += `L${s[i]} ${s[i + 1]}`;
      return s.length === 2 ? `${path}l0 0` : path;
    })
    .join('');
  return `<svg class="paper-signature" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIGN_WIDTH} ${SIGN_HEIGHT}" role="img" aria-label="Підпис"><path d="${d}" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** A signature on a line of a sheet: the line's index (signLines order). */
export type SheetSignature = {
  row: number;
  strokes: Strokes;
  /** Under the line, small: «Підписано в DigiComp HUB 16.11.2026, 14:32». */
  note: string;
};

function esc(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

/** A line to sign on of a sheet (structureInner's signLine), up to its paragraph's end. */
const SIGN_LINE =
  /<p class="paper-sign"><span class="paper-sign-line"><\/span>([\s\S]*?)<\/p>/g;

/**
 * A snapshot's sheet with its drawn signatures: each over its line, its
 * note under it. The snapshot itself (and its hash) is not changed: this
 * is what the print and the DOCX show.
 */
export function signedSheet(sheet: string, signatures: SheetSignature[]) {
  if (!signatures.length) return sheet;
  const byRow = new Map(signatures.map((s) => [s.row, s]));
  let row = 0;
  return sheet.replace(SIGN_LINE, (line: string, rest: string) => {
    const s = byRow.get(row++);
    return s
      ? `<p class="paper-sign"><span class="paper-sign-line">${signatureSvg(s.strokes)}</span>${rest}</p><p class="paper-signed-note">${esc(s.note)}</p>`
      : line;
  });
}

/** How a sheet names a drawn signature: in the print and the DOCX. */
export const SIGNED_IN = 'Підписано в DigiComp HUB';
