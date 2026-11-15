import { describe, expect, it } from 'vitest';
import { FIELD_KEY } from '../../../../shared/editor-schema';
import { BLOCK_GROUPS, BLOCKS, fieldBlockOf, findBlocks, textBlockOf } from '.';

/** Field types the API takes (api/src/records/field-types.ts): scalars, `ref:<type>`, `list<…>`. */
const SCALARS = ['text', 'richtext', 'int', 'decimal', 'date', 'datetime', 'bool', 'enum', 'color'];
const validType = (t: string): boolean => {
  const item = /^list<(.+)>$/.exec(t)?.[1];
  if (item) return validType(item);
  return SCALARS.includes(t) || /^ref:[a-z_]+$/.test(t);
};

describe('Реєстр блоків конструктора', () => {
  it('ключі блоків різні; кожен блок у групі з палітри; у полів — тип API, префікс ключа й варіанти свого блоку', () => {
    expect(new Set(BLOCKS.map((b) => b.key)).size).toBe(BLOCKS.length);
    const groups = BLOCK_GROUPS.map((g) => g.key);
    for (const b of BLOCKS) {
      expect(groups).toContain(b.group);
      if (b.kind !== 'field') continue;
      expect(validType(b.type)).toBe(true);
      expect(FIELD_KEY.test(`${b.prefix}1`)).toBe(true);
      for (const v of b.variants ?? []) expect(validType(v.type)).toBe(true);
      if (b.variants) expect(b.variants.map((v) => v.type)).toContain(b.type);
    }
  });

  it('групи палітри: текст, поля, дані застосунку — у порядку зі «Специфікації»', () => {
    const labels = (g: string) => BLOCKS.filter((b) => b.group === g).map((b) => b.label);
    expect(labels('text')).toEqual(['Заголовок', 'Абзац', 'Список', 'Таблиця', 'Розрив сторінки']);
    expect(labels('field')).toEqual(['Рядок', 'Вільна зона', 'Число', 'Дата', 'Вибір', 'Прапорець']);
    expect(labels('data')).toEqual(['Учасник', 'Кілька учасників', 'Обладнання', 'Позиція складу', 'Проєкт', 'ТЗ']);
  });

  it('блок вузла на аркуші й блок типу поля (власний або той, чий це варіант)', () => {
    expect(textBlockOf('orderedList')?.label).toBe('Список');
    expect(textBlockOf('fieldZone')).toBeNull();
    expect(fieldBlockOf('decimal')?.label).toBe('Число');
    expect(fieldBlockOf('list<ref:user>')?.label).toBe('Кілька учасників');
    expect(fieldBlockOf('list<ref:place>')?.label).toBe('Обладнання');
    expect(fieldBlockOf('color')).toBeNull();
  });

  it('«/» шукає за початком слова в назві й у словах блоку', () => {
    expect(findBlocks('').length).toBe(BLOCKS.length);
    expect(findBlocks('чис').map((b) => b.key)).toEqual(['number']);
    expect(findBlocks('учас').map((b) => b.label)).toEqual(['Учасник', 'Кілька учасників']);
    expect(findBlocks('термін').map((b) => b.key)).toEqual(['date']);
    expect(findBlocks('зона').map((b) => b.key)).toEqual(['zone']);
    expect(findBlocks('щось')).toEqual([]);
  });
});
