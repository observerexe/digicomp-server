import { describe, expect, it } from 'vitest';
import { formatDate, formatPoints, initials, plural } from './format';

describe('Формат', () => {
  it('множина українською', () => {
    const f = (n: number) => plural(n, ['бал', 'бали', 'балів']);
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(f)).toEqual([
      'бал', 'бали', 'бали', 'балів', 'балів', 'балів', 'балів', 'бал', 'бали', 'балів', 'бал', 'балів',
    ]);
  });
  it('бали зі знаком і справжнім мінусом', () => {
    expect([formatPoints(15), formatPoints(-15), formatPoints(0)]).toEqual(['+15', '−15', '0']);
  });
  it('дата: рік лише для іншого року, час Києва', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    expect(formatDate('2026-10-01T22:30:00Z', now)).toBe('2 жовт.');
    expect(formatDate('2025-10-02T10:00:00Z', now)).toMatch(/2 жовт\. 2025/);
  });
  it('ініціали', () => {
    expect(initials('Марта Коваль')).toBe('МК');
    expect(initials('  олег ')).toBe('О');
  });
});
