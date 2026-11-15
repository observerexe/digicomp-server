import { describe, expect, it } from 'vitest';
import { fieldDef } from '../test/render';
import { filterFields, matchesFilters, stripeField } from './fields';

const int = fieldDef({ key: 'hours', label: 'Години', type: 'int', dictionary: null, min: 1, max: 40 });
const tags = fieldDef({ key: 'tags', label: 'Теги', type: 'list<enum>', dictionary: 'tags', maxItems: 2 });

describe('Додаткові поля на дошці', () => {
  it('смужка — перше відкрите поле «Вибір з довідника»; фільтри — відкриті поля вибору', () => {
    const closed = fieldDef({ key: 'old', archived: true });
    const second = fieldDef({ key: 'level' });
    expect(stripeField([int, closed, second, fieldDef()])?.key).toBe('level');
    expect(stripeField([int, tags])).toBeUndefined();
    expect(filterFields([int, closed, second, tags]).map((d) => d.key)).toEqual(['level', 'tags']);
  });

  it('фільтр: пункт у полі чи в списку', () => {
    const extra = { typ: 'dyzain', tags: ['a', 'b'] };
    expect(matchesFilters(extra, { typ: 'dyzain', tags: 'b' })).toBe(true);
    expect(matchesFilters(extra, { typ: null, tags: 'c' })).toBe(false);
    expect(matchesFilters({}, { typ: 'dyzain' })).toBe(false);
    expect(matchesFilters({}, { typ: null })).toBe(true);
  });
});
