import {
  checkContent,
  type PaperContent,
  type PaperNode,
} from '../../../shared/editor-schema';
import {
  matchesBody,
  mentionsOf,
  normalizeValue,
  valueRefs,
  isPlainZone,
  sameNodes,
  valueText,
  withZoneText,
  zoneText,
  type FieldSpec,
} from '../../../shared/editor-schema/fields';
import { renderContent } from '../../../shared/editor-schema/render';
import { bodyProblem, type TemplateField } from './template-fields';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const mention = (type: string, id: string): PaperNode => ({
  type: 'mention',
  attrs: { type, id },
});

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
    ['ref:user', U1, U1],
    ['list<ref:task>', [U1, U2], [U1, U2]],
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
    ['ref:user', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'],
    ['list<ref:user>', ['id']],
    ['list<ref:user>', [U1, U1]],
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

  it('текст запису — його назва; невидимий — «запис недоступний»', () => {
    const title = (type: string, id: string) =>
      type === 'user' && id === U1 ? 'Іван Петренко' : null;
    expect(valueText('ref:user', U1, null, title)).toBe('Іван Петренко');
    expect(valueText('list<ref:user>', [U1, U2], null, title)).toBe(
      'Іван Петренко, запис недоступний',
    );
  });

  it('записи значень і тексту — кожен раз', () => {
    const fields = [
      { key: 'who', type: 'ref:user' },
      { key: 'team', type: 'list<ref:user>' },
      { key: 'n', type: 'int' },
    ];
    expect(valueRefs(fields, { who: U1, team: [U1, U2], n: 3 })).toEqual([
      { key: 'who', type: 'user', id: U1 },
      { key: 'team', type: 'user', id: U1 },
      { key: 'team', type: 'user', id: U2 },
    ]);
    const content = doc(
      p(mention('task', U1), text(' і '), mention('task', U1)),
      zone('z', p(mention('user', U2))),
    );
    expect(mentionsOf(content)).toEqual([
      { type: 'task', id: U1 },
      { type: 'user', id: U2 },
    ]);
  });
});

describe('Посилання «@» у вмісті', () => {
  it('лише тип і id, обидва обов’язкові й правильні', () => {
    expect(checkContent(doc(p(mention('task', U1))))).toBe(true);
    expect(
      checkContent(doc(p({ type: 'mention', attrs: { type: 'task' } }))),
    ).toBe(false);
    expect(checkContent(doc(p(mention('Task', U1))))).toBe(false);
    expect(checkContent(doc(p(mention('task', 'x'))))).toBe(false);
    expect(
      checkContent(
        doc(
          p({ type: 'mention', attrs: { type: 'task', id: U1, title: 'а' } }),
        ),
      ),
    ).toBe(false);
  });

  it('проста зона не бере посилань', () => {
    expect(isPlainZone(zone('z', p(text('а'), mention('task', U1))))).toBe(
      false,
    );
  });

  it('друк: назва запису, екранована; невидимий — «запис недоступний»', () => {
    const body = doc(p(mention('task', U1), text(' '), mention('task', U2)));
    expect(renderContent(body)).toBe(
      `<p><span class="paper-ref" data-ref-type="task" data-ref-id="${U1}"></span> <span class="paper-ref" data-ref-type="task" data-ref-id="${U2}"></span></p>`,
    );
    const fill = {
      text: () => null,
      hidden: () => false,
      title: (_t: string, id: string) => (id === U1 ? '<ТЗ>' : null),
      number: null,
    };
    expect(renderContent(body, fill)).toBe(
      '<p><span class="paper-ref">&lt;ТЗ&gt;</span> <span class="paper-ref">запис недоступний</span></p>',
    );
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
      title: () => null,
      number: null,
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

describe('«Авто: номер»', () => {
  const body: PaperContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '№ ' }, { type: 'paperNumber' }],
      },
    ],
  };
  const fill = (number: string | null) => ({
    text: () => null,
    hidden: () => false,
    title: () => null,
    number,
  });

  it('вузол спільного опису; у редакторі — порожнє місце, у друці — номер або лінія', () => {
    expect(checkContent(body)).toBe(true);
    expect(renderContent(body)).toBe(
      '<p>№ <span class="paper-number"></span></p>',
    );
    expect(renderContent(body, fill('ТЗ-2026-001'))).toBe(
      '<p>№ <span class="paper-field">ТЗ-2026-001</span></p>',
    );
    expect(renderContent(body, fill(null))).toBe(
      '<p>№ <span class="paper-field-blank"></span></p>',
    );
  });
});

describe('withZoneText', () => {
  it('текст у зоні — абзац на рядок без форматування; решта не змінюється', () => {
    const doc: PaperContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Мета:' }] },
        {
          type: 'fieldZone',
          attrs: { key: 'goal' },
          content: [{ type: 'paragraph' }],
        },
      ],
    };
    const out = withZoneText(doc, 'goal', 'Перший\n\nТретій');
    expect(out.content![0]).toEqual(doc.content![0]);
    expect(out.content![1]).toEqual({
      type: 'fieldZone',
      attrs: { key: 'goal' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Перший' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Третій' }] },
      ],
    });
    expect(withZoneText(doc, 'other', 'x')).toEqual(doc);
  });
});
