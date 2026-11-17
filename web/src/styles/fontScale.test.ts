import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs from web/.
const tokens = JSON.parse(readFileSync(join(process.cwd(), '..', 'docs', 'design', 'tokens.json'), 'utf8')) as {
  fontPhone: Record<string, number | string>;
};
const scale = Object.entries(tokens.fontPhone).filter(([k]) => !k.startsWith('$')) as [string, number][];

// Sizes that stay as they are on a phone: the document sheet and its ruler (the sheet zooms as a whole) and avatar initials
// (the avatar keeps its size); print stickers are set in pt.
const FIXED = new Set(['src/editor/format.css', 'src/editor/Ruler.module.css', 'src/components/Avatar.module.css']);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('Шрифт інтерфейсу на телефоні (tokens.json → fontPhone)', () => {
  it('на телефоні розмір не більший, ніж на комп’ютері, і не менший за 11 px', () => {
    for (const [desktop, phone] of scale) {
      expect(phone).toBeLessThanOrEqual(Number(desktop));
      expect(phone).toBeGreaterThanOrEqual(11);
    }
  });

  it('розміри в CSS інтерфейсу — змінні --fs-*, і кожна є в токенах', () => {
    const known = new Set(scale.map(([k]) => `--fs-${k}`));
    const problems: string[] = [];
    for (const file of cssFiles(join(process.cwd(), 'src'))) {
      const rel = relative(process.cwd(), file).replaceAll('\\', '/');
      if (FIXED.has(rel) || rel === 'src/styles/tokens.css') continue;
      for (const [, value] of readFileSync(file, 'utf8').matchAll(/font-size:\s*([^;]+);/g)) {
        const v = value!.trim();
        const used = /^var\((--fs-\d+)\)$/.exec(v)?.[1];
        if (used ? !known.has(used) : !/pt$|^max\(16px, 1em\)$|^inherit$/.test(v)) problems.push(`${rel}: ${v}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
