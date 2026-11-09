import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, errorText } from './messages';

// Collects every errorCode the backend can return (same rules as
// api/src/common/http-exception.filter.ts) and checks each has a text.
// Vitest runs from web/.
const API_SRC = join(process.cwd(), '..', 'api', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return n.endsWith('.ts') && !n.endsWith('.spec.ts') ? [p] : [];
  });
}

function backendCodes() {
  const codes = new Set<string>();
  const filter = readFileSync(join(API_SRC, 'common', 'http-exception.filter.ts'), 'utf8');
  for (const m of filter.matchAll(/:\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]!);
  const policy = readFileSync(join(API_SRC, 'auth', 'policy.ts'), 'utf8');
  const deny = /export const Deny = \{([\s\S]*?)\}/.exec(policy)![1]!;
  for (const m of deny.matchAll(/'([A-Z_]+)'/g)) codes.add(m[1]!);
  for (const f of files(API_SRC)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/errorCode:\s*'([A-Z][A-Z0-9_]+)'/g)) codes.add(m[1]!);
    for (const m of s.matchAll(/'([^'\n]+) not found'/g)) {
      codes.add(m[1]!.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_NOT_FOUND');
    }
  }
  return [...codes].sort();
}

describe('Тексти помилок', () => {
  it('для кожного коду з бекенду є людський текст', () => {
    const codes = backendCodes();
    expect(codes.length).toBeGreaterThan(80);
    expect(codes.filter((c) => !ERROR_MESSAGES[c])).toEqual([]);
  });

  it('невідомий код не дає порожнього тексту', () => {
    expect(errorText('SOMETHING_NEW')).toBe(ERROR_MESSAGES.ERROR);
    expect(errorText('WIDGET_NOT_FOUND')).toBe(ERROR_MESSAGES.NOT_FOUND);
    expect(errorText(undefined)).toBe(ERROR_MESSAGES.ERROR);
    expect(errorText('NETWORK')).toMatch(/з’єднання/);
  });

  it('жодного «Щось пішло не так»', () => {
    for (const t of Object.values(ERROR_MESSAGES)) {
      expect(t).not.toMatch(/щось пішло не так/i);
      expect(t.length).toBeGreaterThan(5);
    }
  });
});
