import {
  extraFieldSchema,
  normalizeExtraValue,
  type ExtraDef,
} from './extra-values';

// Значення додаткових полів: що приймається, що очищає поле, що — помилка.

function def(type: ExtraDef['type'], over: Partial<ExtraDef> = {}): ExtraDef {
  return {
    key: 'k',
    label: 'Поле',
    type,
    required: false,
    dictionary: type.includes('enum') ? 'typ_tz' : null,
    min: null,
    max: null,
    maxLength: type === 'text' ? 10 : null,
    maxItems: type === 'list<enum>' ? 3 : null,
    archived: false,
    ...over,
  };
}

const INVALID = undefined;

describe('normalizeExtraValue', () => {
  it.each([
    ['text', '  Дизайн  ', 'Дизайн'],
    ['text', '   ', INVALID],
    ['text', 'x'.repeat(11), INVALID],
    ['text', 5, INVALID],
    ['int', 7, 7],
    ['int', 7.5, INVALID],
    ['int', '7', INVALID],
    ['int', 2e9, INVALID],
    ['decimal', 2.75, 2.75],
    ['decimal', 0.1 + 0.2, INVALID],
    ['decimal', 1.005, INVALID],
    ['decimal', Number.NaN, INVALID],
    ['date', '2026-11-14', '2026-11-14'],
    ['date', '2026-02-30', INVALID],
    ['date', '2026-11-14T10:00:00Z', INVALID],
    ['bool', false, false],
    ['bool', 'true', INVALID],
    ['enum', 'dyzain', 'dyzain'],
    ['enum', '', INVALID],
    ['enum', 'x'.repeat(41), INVALID],
    ['list<enum>', ['a', 'b'], ['a', 'b']],
    ['list<enum>', [], null],
    ['list<enum>', ['a', 'a'], INVALID],
    ['list<enum>', ['a', 'b', 'c', 'd'], INVALID],
    ['list<enum>', 'a', INVALID],
  ] as const)('%s: %j → %j', (type, value, expected) => {
    expect(normalizeExtraValue(def(type), value)).toEqual(expected);
  });

  it('null очищає поле будь-якого типу', () => {
    expect(normalizeExtraValue(def('int'), null)).toBeNull();
  });

  it('межі чисел із визначення поля', () => {
    const d = def('int', { min: 1, max: 5 });
    expect(normalizeExtraValue(d, 0)).toBe(INVALID);
    expect(normalizeExtraValue(d, 1)).toBe(1);
    expect(normalizeExtraValue(d, 5)).toBe(5);
    expect(normalizeExtraValue(d, 6)).toBe(INVALID);
  });
});

describe('extraFieldSchema', () => {
  it('поле схеми з межами за замовчуванням', () => {
    expect(extraFieldSchema(def('int', { required: true }))).toEqual({
      key: 'k',
      label: 'Поле',
      type: 'int',
      source: 'extra',
      required: true,
      create: true,
      update: true,
      min: -1e9,
      max: 1e9,
    });
  });

  it('архівне: лише для читання, не обов’язкове', () => {
    const f = extraFieldSchema(def('enum', { required: true, archived: true }));
    expect(f).toMatchObject({
      archived: true,
      nullable: true,
      create: false,
      update: false,
      dictionary: 'typ_tz',
    });
    expect(f.required).toBeUndefined();
  });
});
