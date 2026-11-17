import { describe, expect, it } from 'vitest';
import { FIELD_KEY } from '../../../../shared/editor-schema';
import type { RecordSchema } from '../../api/types';
import { newField } from '../template';
import { BLOCK_GROUPS, BLOCKS, fieldBlockOf, findBlocks, textBlockOf } from '.';
import { paletteOf, schemaBlocks } from './schema';

/** Field types the API takes (api/src/records/field-types.ts): scalars, `ref:<type>`, `list<…>`; a template's own — `rows`. */
const SCALARS = ['text', 'richtext', 'int', 'decimal', 'date', 'datetime', 'bool', 'enum', 'color'];
const validType = (t: string): boolean => {
  if (t === 'rows') return true;
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
    expect(labels('text')).toEqual(['Заголовок', 'Абзац', 'Список', 'Таблиця', 'Зображення', 'Розрив сторінки']);
    expect(labels('field')).toEqual(['Рядок', 'Вільна зона', 'Число', 'Дата', 'Вибір', 'Прапорець']);
    expect(labels('data')).toEqual(['Учасник', 'Кілька учасників', 'Обладнання', 'Позиція складу', 'Проєкт', 'Технічне завдання']);
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

describe('Поля запису в палітрі', () => {
  const schema: RecordSchema = {
    type: 'task',
    label: 'ТЗ',
    extensible: true,
    version: 'v1',
    fields: [
      { key: 'title', label: 'Назва', type: 'text', required: true, create: true, maxLength: 200 },
      { key: 'description', label: 'Опис', type: 'text', create: true, maxLength: 5000 },
      { key: 'assigneeIds', label: 'Виконавці', type: 'list<ref:user>', create: true },
      { key: 'status', label: 'Статус', type: 'enum' },
      { key: 'split', label: 'Розподіл балів', type: 'text' },
      { key: 'old', label: 'Старе', type: 'text', create: true, archived: true },
      { key: 'kind', label: 'Тип', type: 'enum', create: true },
    ],
  };

  it('«Створює запис» — спершу поля, які задаються при створенні, потім авто-поля; «Звіт» — запис, потім усі; вільний — немає групи', () => {
    expect(schemaBlocks('creates', schema).map((b) => b.binding)).toEqual(['title', 'description', 'assigneeIds', 'kind', 'status', 'split']);
    expect(schemaBlocks('report', schema).map((b) => b.binding)).toEqual([undefined, 'title', 'description', 'assigneeIds', 'status', 'split', 'kind']);
    expect(paletteOf('free', schema).groups).toEqual(BLOCK_GROUPS);
    const palette = paletteOf('creates', schema);
    expect(palette.groups[0]).toEqual({ key: 'schema', label: 'Поля запису «ТЗ»' });
    expect(palette.blocks.length).toBe(BLOCKS.length + 6);
  });

  it('авто-таблиці з джерел сервера — у кінці групи «Авто»: тип джерела й стовпці', () => {
    const sources = [{ key: 'place_sessions', label: 'Журнал сеансів', input: 'ref:place', columns: ['Учасник', 'Початок'] }];
    const blocks = paletteOf('free', null, sources).blocks;
    const auto = blocks.filter((b) => b.group === 'auto');
    expect(auto.at(-1)).toMatchObject({ key: 'table:place_sessions', kind: 'table', label: 'Журнал сеансів', source: 'place_sessions', input: 'ref:place' });
    expect(blocks.length).toBe(BLOCKS.length + 1);
    // The groups stay in order: the table stands right after the other auto blocks.
    expect(blocks.findIndex((b) => b.key === 'table:place_sessions')).toBe(BLOCKS.findLastIndex((b) => b.group === 'auto') + 1);
  });

  it('авто-поле: текст лишається рядком (не зона), підказка — «заповниться із запису»', () => {
    const split = schemaBlocks('creates', schema).find((b) => b.binding === 'split');
    expect(split).toMatchObject({ type: 'text', required: false, hint: 'Заповниться із запису «ТЗ» після публікації' });
  });

  it('тип і вигляд — з поля запису: довгий текст — вільна зона; обов’язковість — лише для «Створює запис»', () => {
    const [title, description, assignees] = schemaBlocks('creates', schema);
    expect(title).toMatchObject({ type: 'text', icon: 'textField', required: true, prefix: 'title' });
    expect(description).toMatchObject({ type: 'richtext', icon: 'zone', required: false });
    expect(assignees).toMatchObject({ type: 'list<ref:user>', icon: 'users' });
    expect(schemaBlocks('report', schema)[1]!.required).toBe(false);
  });

  it('«Звіт»: перший блок — сам запис (обов’язковий, не прив’язаний); поля запису — авто, рядком', () => {
    const [record, title, description] = schemaBlocks('report', schema);
    expect(record).toMatchObject({ type: 'ref:task', label: 'ТЗ', prefix: 'task', required: true });
    expect(record!.binding).toBeUndefined();
    expect(newField(record!, new Set())).toMatchObject({ type: 'ref:task', required: true, editable: false, binding: null });
    expect(title).toMatchObject({ binding: 'title', required: false, hint: 'Підставиться із запису «ТЗ», про який звіт' });
    expect(description).toMatchObject({ type: 'text', binding: 'description' });
  });

  it('нове поле — з ключем поля запису, поки він вільний, прив’язане', () => {
    const [title] = schemaBlocks('creates', schema);
    expect(newField(title!, new Set())).toMatchObject({ key: 'title', label: 'Назва', binding: 'title', required: true });
    expect(newField(title!, new Set(['title']))).toMatchObject({ key: 'title1', label: 'Назва', binding: 'title' });
  });
});
