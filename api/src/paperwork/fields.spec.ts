import {
  checkContent,
  type PaperContent,
  type PaperNode,
} from '../../../shared/editor-schema';
import {
  matchesBody,
  normalizeValue,
  isPlainZone,
  sameNodes,
  valueText,
  zoneText,
  type FieldSpec,
} from '../../../shared/editor-schema/fields';
import { renderContent } from '../../../shared/editor-schema/render';
import { bodyProblem, type TemplateField } from './template-fields';

const spec = (type: string, over: Partial<FieldSpec> = {}): FieldSpec => ({
  key: 'f',
  type,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  scale: null,
  ...over,
});
const doc = (...content: PaperNode[]) =>
  ({ type: 'doc', content }) as PaperContent;
const p = (...content: PaperNode[]): PaperNode => ({
  type: 'paragraph',
  content,
});
const text = (t: string, marks?: { type: string }[]): PaperNode => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const fieldNode = (key: string): PaperNode => ({
  type: 'field',
  attrs: { key },
});
const zone = (key: string, ...content: PaperNode[]): PaperNode => ({
  type: 'fieldZone',
  attrs: { key },
  content,
});

describe('Значення полів (shared/editor-schema/fields.ts)', () => {
  it.each([
    ['text', '  а  ', 'а'],
    ['text', '   ', null],
    ['int', 7, 7],
    ['decimal', 1.25, 1.25],
    ['date', '2026-11-14', '2026-11-14'],
    ['datetime', '2026-11-14T12:00+02:00', '2026-11-14T10:00:00.000Z'],
    ['bool', false, false],
    ['enum', 'k', 'k'],
    ['color', 'teal', 'teal'],
    ['list<int>', [1, 2], [1, 2]],
    ['list<text>', [], null],
    ['text', null, null],
  ])('%s: %j → %j', (type, v, out) => {
    expect(normalizeValue(spec(type), v)).toEqual(out);
  });

  it.each([
    ['text', 5],
    ['text', 'a\nb'],
    ['int', 1.5],
    ['int', 2e9],
    ['decimal', 0.001],
    ['date', '2026-02-29'],
    ['datetime', '2026-11-14'],
    ['bool', 'true'],
    ['enum', 'x'.repeat(41)],
    ['color', 'pink'],
    ['list<enum>', ['a', 'a']],
    ['list<int>', 3],
    ['ref:user', 'id'],
    ['list<ref:user>', ['id']],
    ['richtext', 'текст'],
  ])('%s: %j — невірне', (type, v) => {
    expect(normalizeValue(spec(type), v)).toBeUndefined();
  });

  it('межі поля', () => {
    const f = spec('int', { min: 1, max: 3 });
    expect(normalizeValue(f, 0)).toBeUndefined();
    expect(normalizeValue(f, 4)).toBeUndefined();
    expect(
      normalizeValue(spec('text', { maxLength: 2 }), 'abc'),
    ).toBeUndefined();
    expect(
      normalizeValue(spec('list<int>', { maxItems: 1 }), [1, 2]),
    ).toBeUndefined();
    expect(normalizeValue(spec('decimal', { scale: 3 }), 0.001)).toBe(0.001);
  });

  it('текст значення', () => {
    expect(valueText('int', 1500)).toBe('1 500');
    expect(valueText('decimal', 2.5)).toBe('2,5');
    expect(valueText('date', '2026-12-01')).toBe('01.12.2026');
    expect(valueText('datetime', '2026-12-01T10:00:00.000Z')).toBe(
      '01.12.2026, 12:00',
    );
    expect(valueText('bool', true)).toBe('так');
    expect(valueText('color', 'teal')).toBe('бірюзовий');
    expect(
      valueText(
        'list<enum>',
        ['a', 'b', 'gone'],
        [
          { key: 'a', label: 'Перший' },
          { key: 'b', label: 'Другий', archived: true },
        ],
      ),
    ).toBe('Перший, Другий, gone');
  });
});

describe('Документ і тіло шаблону', () => {
  const body = doc(p(text('Ім’я: '), fieldNode('name')), zone('goal', p()));

  it('різниця лише в зонах — збігається', () => {
    expect(
      matchesBody(
        doc(
          p(text('Ім’я: '), fieldNode('name')),
          zone('goal', p(text('Мета'))),
        ),
        body,
      ),
    ).toBe(true);
  });

  it('атрибути за замовчуванням, порядок позначок і розбитий текст — те саме', () => {
    const a = doc({
      type: 'paragraph',
      attrs: { align: null, indent: 0 },
      content: [text('А'), text('б', [{ type: 'italic' }, { type: 'bold' }])],
    });
    const b = doc(
      p(text('А'), text('б', [{ type: 'bold' }, { type: 'italic' }])),
    );
    expect(matchesBody(a, b)).toBe(true);
    expect(matchesBody(doc(p(text('Аб'))), doc(p(text('А'), text('б'))))).toBe(
      true,
    );
    expect(sameNodes(a, b)).toBe(true);
  });

  it('інший текст чи поле поза зоною — не збігається', () => {
    expect(
      matchesBody(
        doc(p(text('Ім’я:'), fieldNode('name')), zone('goal', p())),
        body,
      ),
    ).toBe(false);
    expect(matchesBody(doc(p(text('Ім’я: ')), zone('goal', p())), body)).toBe(
      false,
    );
    expect(
      matchesBody(
        doc(p(text('Ім’я: '), fieldNode('other')), zone('goal', p())),
        body,
      ),
    ).toBe(false);
  });

  it('проста зона — абзаци без форматування; текст зони', () => {
    expect(isPlainZone(zone('g', p(text('а')), p()))).toBe(true);
    expect(isPlainZone(zone('g', p(text('а', [{ type: 'bold' }]))))).toBe(
      false,
    );
    expect(
      isPlainZone(
        zone('g', {
          type: 'heading',
          attrs: { level: 1 },
          content: [text('а')],
        }),
      ),
    ).toBe(false);
    expect(
      isPlainZone(
        zone('g', {
          type: 'paragraph',
          attrs: { align: 'center' },
          content: [text('а')],
        }),
      ),
    ).toBe(false);
    expect(
      zoneText(
        zone('g', p(text('а'), { type: 'hardBreak' }, text('б')), p(text('в'))),
      ),
    ).toBe('а\nб\nв');
  });

  it('вміст з полями проходить перевірку опису; ключ поля обов’язковий і латиницею', () => {
    expect(checkContent(body)).toBe(true);
    expect(checkContent(doc(p({ type: 'field' })))).toBe(false);
    expect(
      checkContent(doc(p({ type: 'field', attrs: { key: 'Ім’я' } }))),
    ).toBe(false);
    expect(checkContent(doc(zone('goal')))).toBe(true);
  });
});

describe('Тіло шаблону й поля (bodyProblem)', () => {
  const f = (key: string, type = 'text', binding: string | null = null) =>
    ({ key, type, binding }) as TemplateField;

  it('усе на місці', () => {
    const body = doc(p(fieldNode('a'), fieldNode('a')), zone('z', p()));
    expect(bodyProblem(body, [f('a'), f('z', 'richtext')])).toBeNull();
  });

  it.each([
    ['поля немає в тілі', doc(p()), 'a'],
    ['невідомий ключ', doc(p(fieldNode('a'), fieldNode('x'))), 'x'],
    [
      'вбудоване поле для richtext',
      doc(p(fieldNode('a'), fieldNode('z'))),
      'z',
    ],
    ['зона для text', doc(zone('a', p()), zone('z', p())), 'a'],
    ['зона двічі', doc(p(fieldNode('a')), zone('z', p()), zone('z', p())), 'z'],
    ['поле в зоні', doc(zone('z', p(fieldNode('a')))), 'a'],
  ])('%s', (_, body, key) => {
    expect(bodyProblem(body, [f('a'), f('z', 'richtext')])).toEqual({
      field: key,
    });
  });

  it('прив’язана зона починається простим текстом', () => {
    const fields = [f('z', 'richtext', 'description')];
    expect(
      bodyProblem(doc(zone('z', p(text('а', [{ type: 'bold' }])))), fields),
    ).toEqual({ field: 'z' });
    expect(bodyProblem(doc(zone('z', p(text('а')))), fields)).toBeNull();
  });
});

describe('Рендер полів', () => {
  const body = doc(
    p(text('Ім’я: '), fieldNode('name')),
    zone('goal', p(text('Мета'))),
  );

  it('без значень — як у редакторі', () => {
    expect(renderContent(body)).toBe(
      '<p>Ім’я: <span class="paper-field" data-field="name"></span></p><div class="paper-zone" data-field="goal"><p>Мета</p></div>',
    );
  });

  it('зі значеннями: текст екранується, порожнє — лінія, приховане — немає', () => {
    const fill = (values: Record<string, string>, hidden: string[] = []) => ({
      text: (k: string) => values[k] ?? null,
      hidden: (k: string) => hidden.includes(k),
    });
    expect(renderContent(body, fill({ name: '<Іван>' }))).toBe(
      '<p>Ім’я: <span class="paper-field">&lt;Іван&gt;</span></p><div class="paper-zone" data-field="goal"><p>Мета</p></div>',
    );
    expect(renderContent(body, fill({}))).toContain(
      '<span class="paper-field-blank"></span>',
    );
    expect(renderContent(body, fill({ name: 'І' }, ['name', 'goal']))).toBe(
      '<p>Ім’я: </p>',
    );
  });
});
