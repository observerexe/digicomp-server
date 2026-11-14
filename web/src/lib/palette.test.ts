import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE } from './palette';

// Vitest runs from web/.
type Shade = { solid: string; soft: string; text: string };
const tokens = JSON.parse(readFileSync(join(process.cwd(), '..', 'docs', 'design', 'tokens.json'), 'utf8')) as {
  color: Record<'light' | 'dark', Record<string, string>>;
  palette: Record<string, { light: Shade; dark: Shade } | string>;
};
const palette = Object.entries(tokens.palette).filter(([k]) => !k.startsWith('$')) as [string, { light: Shade; dark: Shade }][];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe('Палітра довідників (docs/design/tokens.json)', () => {
  it('8 кольорів, ті самі, що на фронті', () => {
    expect(palette.map(([name]) => name)).toEqual(PALETTE.map((c) => c.name));
  });

  it.each(['light', 'dark'] as const)('контраст у темі %s', (theme) => {
    const { surface, surface2 } = tokens.color[theme];
    for (const [name, c] of palette) {
      const shade = c[theme];
      for (const bg of [surface!, surface2!]) {
        expect([name, contrast(shade.solid, bg) >= 3]).toEqual([name, true]);
        expect([name, contrast(shade.text, bg) >= 4.5]).toEqual([name, true]);
      }
      expect([name, contrast(shade.text, shade.soft) >= 4.5]).toEqual([name, true]);
    }
  });

  it('текст на білому аркуші документа читається', () => {
    for (const [name, c] of palette) {
      expect([name, contrast(c.light.text, '#FFFFFF') >= 4.5]).toEqual([name, true]);
    }
  });
});
