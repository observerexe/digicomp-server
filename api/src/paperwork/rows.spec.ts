import type { EntityManager } from 'typeorm';
import {
  checkContent,
  type PaperContent,
  type PaperNode,
} from '../../../shared/editor-schema';
import {
  matchesBody,
  normalizeValue,
  rowsOf,
  rowsText,
  valueRefs,
  valueText,
  type FieldSpec,
} from '../../../shared/editor-schema/fields';
import {
  renderContent,
  type FieldFill,
} from '../../../shared/editor-schema/render';
import { checkContent as checkPaperContent } from './paper-fields';
import { checkValues, resolveFields, type PaperField } from './paper-fields';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  fieldsProblem,
  type TemplateField,
} from './template-fields';

/** «Повторювані рядки»: a table whose last row repeats, a row a value of a `rows` field. */

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const doc = (...content: PaperNode[]) =>
  ({ type: 'doc', content }) as PaperContent;
const p = (...content: PaperNode[]): PaperNode => ({
  type: 'paragraph',
  content,
});
const text = (t: string): PaperNode => ({ type: 'text', text: t });
const fieldNode = (key: string): PaperNode => ({
  type: 'field',
  attrs: { key },
});
const rowNumber: PaperNode = { type: 'rowNumber' };
const th = (...content: PaperNode[]): PaperNode => ({
  type: 'tableHeader',
  content: [p(...content)],
});
const td = (...content: PaperNode[]): PaperNode => ({
  type: 'tableCell',
  content: [p(...content)],
});
const tr = (...cells: PaperNode[]): PaperNode => ({
  type: 'tableRow',
  content: cells,
});
const repeat = (key: string, ...rows: PaperNode[]): PaperNode => ({
  type: 'repeat',
  attrs: { key },
  content: [{ type: 'table', content: rows }],
});

/** «№ | Учасник | Бали»: the header, then the row that repeats. */
const body = doc(
  p(text('Відомість')),
  repeat(
    'rows1',
    tr(th(text('№')), th(text('Учасник')), th(text('Бали'))),
    tr(td(rowNumber), td(fieldNode('member')), td(fieldNode('points'))),
  ),
);

const tf = (
  over: Partial<TemplateField> & Pick<TemplateField, 'key'>,
): TemplateField => ({
  label: over.key,
  type: 'text',
  required: false,
  fill: 'author',
  editable: false,
  print: true,
  binding: null,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  dictionary: null,
  ...over,
});
const fields = [
  tf({ key: 'rows1', type: 'rows', label: 'Нарахування', required: true }),
  tf({ key: 'member', type: 'ref:user', label: 'Учасник', required: true }),
  tf({ key: 'points', type: 'int', label: 'Бали', min: 1, max: 100 }),
];

const spec = (key: string, type: string, over: Partial<FieldSpec> = {}) => ({
  key,
  type,
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  scale: null,
  ...over,
});
const rowsSpec: FieldSpec = spec('rows1', 'rows', {
  maxItems: 3,
  columns: [spec('member', 'ref:user'), spec('points', 'int', { min: 1 })],
});

describe('Повторювані рядки: вузли спільного опису', () => {
  it('блок — лише на верхньому рівні, з ключем; «№ рядка» — лише в ньому', () => {
    expect(checkContent(body)).toBe(true);
    expect(
      checkContent(
        doc({ type: 'repeat', content: [{ type: 'table', content: [] }] }),
      ),
    ).toBe(false);
    expect(
      checkContent(
        doc({
          type: 'conditional',
          attrs: { field: 'kind', value: 'a' },
          content: [repeat('rows1', tr(td()))],
        }),
      ),
    ).toBe(false);
    expect(checkContent(doc(p(rowNumber)))).toBe(false);
    expect(checkContent(doc(repeat('rows1', tr(td(rowNumber)))))).toBe(true);
  });

  it('стовпці — поля рядка, що повторюється, без повторів', () => {
    expect([...rowsOf(body)]).toEqual([['rows1', ['member', 'points']]]);
  });

  it('документ тримається тіла: рядки — у значеннях, не в тексті', () => {
    const more = doc(
      p(text('Відомість')),
      repeat(
        'rows1',
        tr(th(text('№')), th(text('Учасник')), th(text('Бали'))),
        tr(td(rowNumber), td(fieldNode('member')), td(fieldNode('points'))),
        tr(td(rowNumber), td(fieldNode('member')), td(fieldNode('points'))),
      ),
    );
    expect(matchesBody(body, body)).toBe(true);
    expect(matchesBody(more, body)).toBe(false);
  });
});

describe('Повторювані рядки: значення', () => {
  it('рядки нормалізуються: порожні клітинки йдуть, порожній рядок лишається', () => {
    expect(
      normalizeValue(rowsSpec, [
        { member: U1, points: 5 },
        { points: null },
        {},
      ]),
    ).toEqual([{ member: U1, points: 5 }, {}, {}]);
    expect(normalizeValue(rowsSpec, [])).toBeNull();
    expect(normalizeValue(rowsSpec, null)).toBeNull();
  });

  it('недійсне: не список, забагато рядків, чужий стовпець, клітинка поза межами', () => {
    expect(normalizeValue(rowsSpec, { member: U1 })).toBeUndefined();
    expect(normalizeValue(rowsSpec, [{}, {}, {}, {}])).toBeUndefined();
    expect(normalizeValue(rowsSpec, [{ other: 1 }])).toBeUndefined();
    expect(normalizeValue(rowsSpec, [{ points: 0 }])).toBeUndefined();
    expect(normalizeValue(rowsSpec, [[U1]])).toBeUndefined();
    expect(normalizeValue(rowsSpec, ['x'])).toBeUndefined();
  });

  it('за замовчуванням — до 50 рядків', () => {
    const free = { ...rowsSpec, maxItems: null };
    expect(normalizeValue(free, Array(50).fill({}))).toHaveLength(50);
    expect(normalizeValue(free, Array(51).fill({}))).toBeUndefined();
  });

  it('текст значення — кількість рядків', () => {
    expect(valueText('rows', [{}, {}, {}])).toBe('3 рядки');
    expect(rowsText(1)).toBe('1 рядок');
    expect(rowsText(5)).toBe('5 рядків');
    expect(rowsText(11)).toBe('11 рядків');
    expect(rowsText(22)).toBe('22 рядки');
  });

  it('посилання з клітинок: роль — ключ стовпця, запис — один раз, з першим рядком', () => {
    expect(
      valueRefs([rowsSpec], {
        rows1: [{ member: U1 }, { member: U2 }, { member: U1 }],
      }),
    ).toEqual([
      { key: 'member', type: 'user', id: U1, rows: 'rows1', row: 0 },
      { key: 'member', type: 'user', id: U2, rows: 'rows1', row: 1 },
    ]);
  });
});

/** Fields as a document fills them: the columns inside their rows field. */
const resolved = () =>
  resolveFields(
    {} as EntityManager,
    TemplateKind.Free,
    [
      ...fields,
      tf({ key: 'kind', type: 'bool' }),
      tf({ key: 'color', type: 'color' }),
    ],
    null,
    doc(
      ...(body.content ?? []),
      p(fieldNode('kind')),
      repeat('rows2', tr(td(fieldNode('color')))),
    ),
  );

describe('Повторювані рядки: поля документа', () => {
  it('стовпці — усередині поля рядків, з його «хто заповнює», зміною й друком', async () => {
    const list = await resolved();
    expect(list.map((f) => f.key)).toEqual(['rows1', 'kind']);
    const rows = list[0]!;
    expect(rows.columns?.map((c) => c.key)).toEqual(['member', 'points']);
    expect(rows.columns?.[1]).toMatchObject({
      min: 1,
      max: 100,
      fill: 'author',
      print: true,
    });
    // A rows field not on the sheet: the field `rows2` has no settings, its column stays out.
    expect(list.find((f) => f.key === 'color')).toBeUndefined();
  });

  it('збереження: рядок з помилкою — з номером рядка', async () => {
    const [rows] = await resolved();
    const ok = checkValues(
      { rows1: [{ member: U1, points: 3 }, {}] },
      [rows!],
      {},
      false,
    );
    expect(ok).toEqual({ rows1: [{ member: U1, points: 3 }, {}] });
    expect(() =>
      checkValues(
        { rows1: [{ points: 3 }, { points: 0 }] },
        [rows!],
        {},
        false,
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ field: 'rows1', row: 1 }),
      }),
    );
  });

  it('вибір у клітинці: активний варіант або той, що вже є в стовпці', () => {
    const rows: PaperField = {
      ...spec('rows1', 'rows'),
      label: 'Рядки',
      required: false,
      fill: 'author',
      editable: false,
      print: true,
      options: null,
      plain: false,
      binding: null,
      auto: false,
      columns: [
        {
          ...spec('kind', 'enum'),
          label: 'Вид',
          required: false,
          fill: 'author',
          editable: false,
          print: true,
          options: [
            { key: 'a', label: 'А' },
            { key: 'old', label: 'Старий', archived: true },
          ],
          plain: false,
          binding: null,
          auto: false,
          columns: null,
        },
      ],
    };
    expect(checkValues({ rows1: [{ kind: 'a' }] }, [rows], {}, false)).toEqual({
      rows1: [{ kind: 'a' }],
    });
    expect(() =>
      checkValues(
        { rows1: [{ kind: 'a' }, { kind: 'old' }] },
        [rows],
        {},
        false,
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ field: 'rows1', row: 1 }),
      }),
    );
    const had = { rows1: [{ kind: 'old' }] };
    expect(
      checkValues({ rows1: [{ kind: 'old' }] }, [rows], had, false),
    ).toEqual(had);
  });

  it('вільний документ без полів: блок рядків — PAPER_CONTENT_LOCKED', () => {
    expect(() =>
      checkPaperContent(doc(repeat('rows1', tr(td()))), null, [], doc(), true),
    ).toThrow('Paper content is locked by its template');
  });
});

describe('Повторювані рядки: тіло шаблону', () => {
  it('добре: блок раз, стовпці в рядку, що повторюється', () => {
    expect(bodyProblem(body, fields)).toBeNull();
  });

  it('поле рядків — лише блоком, раз, і має бути типу rows', () => {
    expect(
      bodyProblem(doc(...(body.content ?? []), p(fieldNode('rows1'))), fields),
    ).toEqual({ field: 'rows1' });
    expect(
      bodyProblem(
        doc(...(body.content ?? []), ...(body.content ?? []).slice(1)),
        fields,
      ),
    ).toEqual({ field: 'rows1' });
    expect(
      bodyProblem(body, [
        tf({ key: 'rows1', type: 'text' }),
        ...fields.slice(1),
      ]),
    ).toEqual({ field: 'rows1' });
    // Rows without a block on the sheet.
    expect(
      bodyProblem(doc(p(fieldNode('member'), fieldNode('points'))), fields),
    ).toEqual({
      field: 'rows1',
    });
  });

  it('шапка без полів і «№ рядка»; без зон; одна таблиця', () => {
    const head = (...cells: PaperNode[]) =>
      doc(
        repeat(
          'rows1',
          tr(...cells),
          tr(td(fieldNode('member')), td(fieldNode('points'))),
        ),
      );
    expect(bodyProblem(head(th(fieldNode('points'))), fields)).toEqual({
      field: 'rows1',
    });
    expect(bodyProblem(head(th(rowNumber)), fields)).toEqual({
      field: 'rows1',
    });
    const zoneInRow = doc(
      repeat(
        'rows1',
        tr(td(fieldNode('member')), td(fieldNode('points')), {
          type: 'tableCell',
          content: [{ type: 'fieldZone', attrs: { key: 'z' }, content: [p()] }],
        }),
      ),
    );
    expect(
      bodyProblem(zoneInRow, [...fields, tf({ key: 'z', type: 'richtext' })]),
    ).toEqual({ field: 'rows1' });
  });

  it('стовпець: не зона, не рядки, без прив’язки, ніде більше на аркуші', () => {
    expect(
      bodyProblem(body, [
        fields[0]!,
        fields[1]!,
        tf({ key: 'points', type: 'int', binding: 'points' }),
      ]),
    ).toEqual({ field: 'points' });
    expect(
      bodyProblem(doc(...(body.content ?? []), p(fieldNode('points'))), fields),
    ).toEqual({ field: 'points' });
    // Who signs — a member of a column.
    expect(
      bodyProblem(
        doc(...(body.content ?? []), {
          type: 'signatures',
          attrs: { leftSigner: 'member' },
        }),
        fields,
      ),
    ).toEqual({ field: 'member' });
    // Two blocks share a column.
    expect(
      bodyProblem(
        doc(
          ...(body.content ?? []),
          repeat('rows2', tr(td(fieldNode('points')))),
        ),
        [...fields, tf({ key: 'rows2', type: 'rows' })],
      ),
    ).toEqual({ field: 'points' });
  });

  it('поле рядків: межа рядків — так, прив’язка — ні', () => {
    const known = {
      dictionaries: new Set<string>(),
      refTypes: new Set(['user']),
    };
    const withRows = (over: Partial<TemplateField>) => [
      tf({ key: 'rows1', type: 'rows', ...over }),
      ...fields.slice(1),
    ];
    expect(
      fieldsProblem(withRows({ maxItems: 30 }), TemplateKind.Free, null, known),
    ).toBeNull();
    expect(
      fieldsProblem(
        withRows({ binding: 'points' }),
        TemplateKind.Report,
        null,
        known,
      ),
    ).toEqual({ field: 'rows1' });
    expect(
      fieldsProblem(withRows({ maxLength: 5 }), TemplateKind.Free, null, known),
    ).toEqual({
      field: 'rows1',
    });
  });
});

describe('Повторювані рядки: рендер', () => {
  const NO_INFO = {
    institution: '',
    groupName: '',
    signerPosition: '',
    person: () => null,
    date: null,
    year: '',
  };
  const one = doc(
    repeat(
      'rows1',
      tr(th(text('№')), th(text('Бали'))),
      tr(td(rowNumber), td(fieldNode('points'))),
    ),
  );
  const fill = (rows: number[], hidden = false): FieldFill => {
    const base: FieldFill = {
      text: () => null,
      hidden: () => hidden,
      holds: () => false,
      title: () => null,
      number: null,
      info: NO_INFO,
    };
    return {
      ...base,
      rows: () =>
        rows.map((v, i) => ({
          ...base,
          row: i + 1,
          hidden: () => false,
          text: (k) => (k === 'points' ? String(v) : null),
        })),
    };
  };

  it('у редакторі — блок і таблиця як є', () => {
    expect(renderContent(one)).toBe(
      '<div class="paper-rows" data-field="rows1"><table><tbody>' +
        '<tr><th><p>№</p></th><th><p>Бали</p></th></tr>' +
        '<tr><td><p><span class="paper-row-number"></span></p></td><td><p><span class="paper-field" data-field="points"></span></p></td></tr>' +
        '</tbody></table></div>',
    );
  });

  it('у друці — шапка, потім рядок на кожне значення з номером', () => {
    expect(renderContent(one, fill([5, 7]))).toBe(
      '<div class="paper-rows"><table><tbody>' +
        '<tr><th><p>№</p></th><th><p>Бали</p></th></tr>' +
        '<tr><td><p>1</p></td><td><p><span class="paper-field">5</span></p></td></tr>' +
        '<tr><td><p>2</p></td><td><p><span class="paper-field">7</span></p></td></tr>' +
        '</tbody></table></div>',
    );
  });

  it('рядків немає — один порожній, щоб заповнити від руки; не друкується — нічого', () => {
    expect(renderContent(one, fill([]))).toBe(
      '<div class="paper-rows"><table><tbody>' +
        '<tr><th><p>№</p></th><th><p>Бали</p></th></tr>' +
        '<tr><td><p></p></td><td><p><span class="paper-field-blank"></span></p></td></tr>' +
        '</tbody></table></div>',
    );
    expect(renderContent(one, fill([5], true))).toBe('');
  });
});
