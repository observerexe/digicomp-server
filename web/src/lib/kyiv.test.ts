import { describe, expect, it } from 'vitest';
import { addDays, kyivDay, kyivParts, kyivToDate } from './kyiv';
import { parseScan, placeUrl } from './scan';

describe('Київський час', () => {
  it('зимовий і літній час (+2 / +3)', () => {
    expect(kyivToDate('2026-11-10', '14:30').toISOString()).toBe('2026-11-10T12:30:00.000Z');
    expect(kyivToDate('2026-07-10', '14:30').toISOString()).toBe('2026-07-10T11:30:00.000Z');
  });
  it('день переходу на літній час', () => {
    // 29 березня 2026: о 03:00 стрілки на 04:00.
    expect(kyivToDate('2026-03-29', '02:00').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(kyivToDate('2026-03-29', '05:00').toISOString()).toBe('2026-03-29T02:00:00.000Z');
    const { start, end } = kyivDay('2026-03-29');
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(23);
  });
  it('назад у київські дату й час', () => {
    expect(kyivParts('2026-11-09T22:30:00Z')).toEqual({ date: '2026-11-10', time: '00:30' });
  });
  it('додавання днів через межу місяця й року', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('Розбір QR', () => {
  const origin = 'https://hub.example.ts.net';
  it('повна адреса застосунку', () => {
    expect(parseScan('https://hub.example.ts.net/lab/CNC-1', origin)).toEqual({ kind: 'place', code: 'CNC-1' });
    expect(parseScan(placeUrl(origin, 'cam-2'), origin)).toEqual({ kind: 'place', code: 'CAM-2' });
  });
  it('просто код', () => {
    expect(parseScan('  cnc-1 ', origin)).toEqual({ kind: 'place', code: 'CNC-1' });
  });
  it('чужий сайт, інший шлях чи сміття — ні', () => {
    expect(parseScan('https://evil.example/lab/CNC-1', origin)).toBeNull();
    expect(parseScan('https://hub.example.ts.net/tasks', origin)).toBeNull();
    expect(parseScan('javascript:alert(1)', origin)).toBeNull();
    expect(parseScan('два слова', origin)).toBeNull();
    expect(parseScan('', origin)).toBeNull();
  });
});
