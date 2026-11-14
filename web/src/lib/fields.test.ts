import { describe, expect, it } from 'vitest';
import { fieldDef } from '../test/render';
import { extraBody, fieldProblem, filterFields, fromForm, matchesFilters, stripeField, toForm } from './fields';

const int = fieldDef({ key: 'hours', label: 'Години', type: 'int', dictionary: null, min: 1, max: 40 });
const decimal = fieldDef({ key: 'cost', label: 'Ціна', type: 'decimal', dictionary: null });
const tags = fieldDef({ key: 'tags', label: 'Теги', type: 'list<enum>', dictionary: 'tags', maxItems: 2 });
const flag = fieldDef({ key: 'urgent', label: 'Терміново', type: 'bool', dictionary: null });

describe('Додаткові поля: значення форми', () => {
  it('у форму й назад', () => {
    expect(toForm(int, 8)).toBe('8');
    expect(toForm(int, undefined)).toBe('');
    expect(toForm(tags, ['a'])).toEqual(['a']);
    expect(toForm(flag, true)).toBe(true);
    expect(fromForm(int, ' 8 ')).toBe(8);
    expect(fromForm(decimal, '2,5')).toBe(2.5);
    expect(fromForm(fieldDef({ type: 'text' }), '  ')).toBeNull();
    expect(fromForm(tags, [])).toBeNull();
    expect(fromForm(flag, false)).toBeNull();
  });

  it('перевірка: обов’язкове, межі, кількість', () => {
    expect(fieldProblem(fieldDef({ required: true }), '')).toBe('Заповніть поле «Тип».');
    expect(fieldProblem(fieldDef(), '')).toBeNull();
    expect(fieldProblem(int, '41')).toBe('«Години»: ціле число від 1 до 40.');
    expect(fieldProblem(int, '1.5')).toMatch(/ціле число/);
    expect(fieldProblem(decimal, '1.555')).toBe('«Ціна»: число з двома знаками після коми.');
    expect(fieldProblem(decimal, '1,55')).toBeNull();
    expect(fieldProblem(tags, ['a', 'b', 'c'])).toBe('«Теги»: не більше 2.');
  });

  it('тіло запиту: при створенні — заповнені, при зміні — лише змінені', () => {
    const archived = fieldDef({ key: 'old', archived: true });
    const defs = [fieldDef(), int, tags, archived];
    const form = { typ: 'dyzain', hours: '', tags: ['a'], old: 'x' };
    expect(extraBody(defs, form)).toEqual({ typ: 'dyzain', tags: ['a'] });
    expect(extraBody(defs, form, { typ: 'dyzain', hours: 5, tags: ['a', 'b'], old: 'y' })).toEqual({ hours: null, tags: ['a'] });
  });
});

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
