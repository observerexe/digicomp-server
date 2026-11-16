import { describe, expect, it } from 'vitest';
import { RECORD_TYPES, recordLabel } from './records';

describe('Назви записів', () => {
  it('кожен тип має людську назву, а не ключ API', () => {
    for (const type of RECORD_TYPES) expect(recordLabel(type)).not.toBe(type);
    expect(recordLabel('discipline_record')).toBe('Стягнення');
    expect(recordLabel('points_entry')).toBe('Нарахування балів');
  });
});
