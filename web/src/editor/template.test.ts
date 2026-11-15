import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import type { RecordSchema } from '../api/types';
import { fieldBlockOf, type FieldBlock } from './blocks';
import { paperExtensions } from './extensions';
import { bindingOptions, defsOf, fieldsOf, fieldTag, keyProblem, keysOf, limitsText, newField, newKey, withType, type FieldDef } from './template';

const block = (type: string) => fieldBlockOf(type) as FieldBlock;
const field = (over: Partial<FieldDef>): FieldDef => ({ ...newField(block('text'), new Set()), ...over });

const schema: RecordSchema = {
  type: 'task',
  label: 'ТЗ',
  extensible: true,
  version: 'v1',
  fields: [
    { key: 'title', label: 'Назва', type: 'text', required: true, create: true, maxLength: 200 },
    { key: 'description', label: 'Мета', type: 'text', create: true, maxLength: 5000 },
    { key: 'points', label: 'Бали', type: 'int', required: true, create: true, min: 0, max: 1000 },
    { key: 'status', label: 'Статус', type: 'enum' },
    { key: 'kind', label: 'Тип', type: 'enum', create: true, dictionary: 'task_kind', source: 'extra', archived: true },
  ],
};

describe('Поля шаблону в конструкторі', () => {
  it('новий ключ — префікс блоку з найменшим вільним номером; підпис — назва блоку (з номером, якщо не перший)', () => {
    expect(newKey('number', new Set(['number1', 'number3']))).toBe('number2');
    const first = newField(block('int'), new Set());
    expect(first).toMatchObject({ key: 'number1', label: 'Число', type: 'int', fill: 'author', required: false, print: true, binding: null });
    expect(newField(block('int'), new Set(['number1'])).label).toBe('Число 2');
  });

  it('поля версії — ті, що на аркуші, у порядку аркуша; поле без налаштувань отримує налаштування рядка чи зони', () => {
    const body = {
      type: 'doc',
      content: [
        { type: 'fieldZone', attrs: { key: 'goal' }, content: [{ type: 'paragraph' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'field', attrs: { key: 'points' } },
            { type: 'field', attrs: { key: 'lost' } },
            { type: 'field', attrs: { key: 'points' } },
          ],
        },
      ],
    };
    const defs = defsOf([field({ key: 'points', type: 'int' }), field({ key: 'gone' })], body);
    expect(defs.get('goal')).toMatchObject({ type: 'richtext', label: 'goal' });
    expect(defs.get('lost')).toMatchObject({ type: 'text', label: 'lost' });
    const editor = new Editor({ extensions: paperExtensions(), injectCSS: false, content: body });
    expect(keysOf(editor.state.doc)).toEqual(['goal', 'points', 'lost']);
    expect(fieldsOf(defs, keysOf(editor.state.doc)).map((f) => f.key)).toEqual(['goal', 'points', 'lost']);
  });

  it('інший вид поля прибирає те, що йому не пасує (межі, довідник, зв’язок); ціле — цілі межі', () => {
    const decimal = field({ type: 'decimal', min: 0.5, max: 9.5, binding: 'points' });
    expect(withType(decimal, 'int')).toMatchObject({ type: 'int', min: 1, max: 9, binding: null });
    expect(withType(field({ type: 'enum', dictionary: 'kinds' }), 'list<enum>')).toMatchObject({ dictionary: 'kinds', maxItems: null });
    expect(withType(field({ type: 'list<enum>', dictionary: 'kinds', maxItems: 3 }), 'enum')).toMatchObject({ dictionary: 'kinds', maxItems: null });
    expect(withType(field({ type: 'date' }), 'datetime').type).toBe('datetime');
  });

  it('ключ: латиницею з малої літери, не зайнятий іншим полем (свій — можна)', () => {
    const taken = new Set(['title', 'points']);
    expect(keyProblem('points', 'points', taken)).toBeNull();
    expect(keyProblem('goal_2', 'points', taken)).toBeNull();
    expect(keyProblem('title', 'points', taken)).toMatch(/уже є/);
    expect(keyProblem('Мета', 'points', taken)).toMatch(/Латиницею/);
    expect(keyProblem('2goal', 'points', taken)).toMatch(/Латиницею/);
  });

  it('зв’язок: «створює» — поля, які задаються при створенні; «звіт» — будь-які; того самого типу; зона — і до тексту; не зайняті', () => {
    const points = field({ key: 'points', type: 'int' });
    const title = field({ key: 'name', type: 'text', binding: 'title' });
    const zone = field({ key: 'goal', type: 'richtext' });
    const choice = field({ key: 'state', type: 'enum' });
    expect(bindingOptions(points, 'creates', schema, [points, title]).map((s) => s.key)).toEqual(['points']);
    expect(bindingOptions(zone, 'creates', schema, [zone, title]).map((s) => s.key)).toEqual(['description']);
    expect(bindingOptions(zone, 'creates', schema, [zone]).map((s) => s.key)).toEqual(['title', 'description']);
    expect(bindingOptions(choice, 'creates', schema, [choice])).toEqual([]);
    expect(bindingOptions(choice, 'report', schema, [choice]).map((s) => s.key)).toEqual(['status']);
    expect(bindingOptions(points, 'free', schema, [points])).toEqual([]);
    expect(bindingOptions(points, 'creates', null, [points])).toEqual([]);
  });

  it('мітка блоку на аркуші: блок · ключ → поле запису · межі · обов’язкове', () => {
    const points = field({ key: 'points', type: 'int', binding: 'points', min: 0, max: 1000, required: true });
    expect(fieldTag(points, schema)).toBe('Число · points → Бали · 0–1000 · обов’язкове');
    expect(fieldTag(field({ key: 'note', maxLength: 200 }), null)).toBe('Рядок · note · до 200 знаків');
    expect(limitsText(field({ min: 5 }))).toBe('від 5');
    expect(limitsText(field({ type: 'list<ref:user>', maxItems: 3 }))).toBe('до 3 шт.');
    expect(limitsText(field({}))).toBeNull();
  });
});
