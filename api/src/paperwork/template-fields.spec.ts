import type { FieldSchema } from '../records/field-types';
import { publishSchema } from '../records/records.registry';
import { TASK_SCHEMA } from '../tasks/task.schema';
import { TemplateKind } from './template.entities';
import {
  bindingProblem,
  fieldDictionaries,
  fieldsProblem,
  type TemplateField,
} from './template-fields';

const field = (
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

const task = publishSchema(TASK_SCHEMA);
/** Everything a task needs to be created: title and points. */
const taskBase = [
  field({ key: 'title', binding: 'title', required: true }),
  field({ key: 'points', type: 'int', binding: 'points', required: true }),
];
const DICTS = {
  dictionaries: new Set(['task_type']),
  refTypes: new Set(['user', 'task']),
};
const C = TemplateKind.Creates;

describe('Поля шаблону: власні межі', () => {
  it.each<[string, Partial<TemplateField>, boolean]>([
    ['текст з довжиною', { type: 'text', maxLength: 50 }, true],
    ['вільна зона з довжиною', { type: 'richtext', maxLength: 5000 }, true],
    ['межі в числа', { type: 'int', min: 0, max: 10 }, true],
    ['межі в тексту', { type: 'text', min: 0 }, false],
    ['дробові межі в цілого', { type: 'int', min: 0.5 }, false],
    ['дробові межі в дробового', { type: 'decimal', min: 0.5, max: 1.5 }, true],
    ['мін більший за макс', { type: 'int', min: 5, max: 1 }, false],
    ['довжина в числа', { type: 'int', maxLength: 5 }, false],
    ['кількість у списку', { type: 'list<ref:user>', maxItems: 5 }, true],
    ['кількість не в списку', { type: 'ref:user', maxItems: 5 }, false],
    ['посилання на тип, який шукає пікер', { type: 'ref:task' }, true],
    ['посилання на тип без пікера', { type: 'ref:session' }, false],
    ['список посилань без пікера', { type: 'list<ref:fault>' }, false],
    ['вибір з довідником', { type: 'enum', dictionary: 'task_type' }, true],
    ['вибір без довідника', { type: 'enum' }, false],
    [
      'вибір з неіснуючим довідником',
      { type: 'enum', dictionary: 'nope' },
      false,
    ],
    [
      'кілька з довідника',
      { type: 'list<enum>', dictionary: 'task_type' },
      true,
    ],
    [
      'довідник не для вибору',
      { type: 'text', dictionary: 'task_type' },
      false,
    ],
  ])('%s', (_name, over, ok) => {
    const p = fieldsProblem(
      [field({ key: 'x', ...over })],
      TemplateKind.Free,
      null,
      DICTS,
    );
    expect(p).toEqual(ok ? null : { field: 'x' });
  });

  it('ключі не повторюються', () => {
    expect(
      fieldsProblem(
        [field({ key: 'a' }), field({ key: 'a' })],
        TemplateKind.Free,
        null,
        DICTS,
      ),
    ).toEqual({ field: 'a' });
  });

  it('вільний шаблон нічого не прив’язує', () => {
    expect(
      fieldsProblem(
        [field({ key: 'a', binding: 'title' })],
        TemplateKind.Free,
        null,
        DICTS,
      ),
    ).toEqual({ field: 'a' });
  });
});

describe('Поля шаблону: прив’язки до схеми', () => {
  const check = (fields: TemplateField[], kind = C) =>
    bindingProblem(fields, kind, task);

  it('усе потрібне для запису прив’язане — добре', () => {
    expect(check(taskBase)).toBeNull();
  });

  it('потрібне поле запису не прив’язане — ключ поля запису', () => {
    expect(check([taskBase[0]])).toEqual({ binding: 'points' });
  });

  it('потрібне поле запису прив’язане як необов’язкове', () => {
    expect(check([taskBase[0], { ...taskBase[1], required: false }])).toEqual({
      field: 'points',
    });
  });

  it('невідоме поле запису', () => {
    expect(check([...taskBase, field({ key: 'x', binding: 'nope' })])).toEqual({
      field: 'x',
    });
  });

  it('поле, якого не задають при створенні (статус), — лише у звіті', () => {
    const status = field({ key: 's', type: 'enum', binding: 'status' });
    expect(check([...taskBase, status])).toEqual({ field: 's' });
    expect(check([status], TemplateKind.Report)).toBeNull();
  });

  it('одне поле запису — один раз', () => {
    expect(
      check([...taskBase, field({ key: 'again', binding: 'title' })]),
    ).toEqual({ field: 'again' });
  });

  it('тип має збігатися', () => {
    expect(
      check([
        taskBase[0],
        field({
          key: 'points',
          type: 'decimal',
          binding: 'points',
          required: true,
        }),
      ]),
    ).toEqual({
      field: 'points',
    });
  });

  it('вільна зона — до текстового поля (опис ТЗ)', () => {
    expect(
      check([
        ...taskBase,
        field({ key: 'goal', type: 'richtext', binding: 'description' }),
      ]),
    ).toBeNull();
  });

  it('межі вужчі — добре, ширші — ні', () => {
    const points = (min: number | null, max: number | null) => [
      taskBase[0],
      field({
        key: 'points',
        type: 'int',
        binding: 'points',
        required: true,
        min,
        max,
      }),
    ];
    expect(check(points(0, 100))).toBeNull();
    expect(check(points(-1, null))).toEqual({ field: 'points' });
    expect(check(points(null, 1001))).toEqual({ field: 'points' });
    // Мінімум понад максимум запису: порожній проміжок.
    expect(check(points(2000, null))).toEqual({ field: 'points' });
  });

  it('довжина тексту — не більша, ніж у запису', () => {
    expect(
      check([
        field({
          key: 'title',
          binding: 'title',
          required: true,
          maxLength: 201,
        }),
        taskBase[1],
      ]),
    ).toEqual({
      field: 'title',
    });
  });

  it('додаткове поле в архіві — не прив’язується', () => {
    const extra: FieldSchema = {
      key: 'kind',
      label: 'Тип',
      type: 'enum',
      dictionary: 'task_type',
      create: true,
      source: 'extra',
    };
    const withExtra = (archived: boolean) =>
      publishSchema(TASK_SCHEMA, [{ ...extra, archived }]);
    const fields = [
      ...taskBase,
      field({ key: 'kind', type: 'enum', binding: 'kind' }),
    ];
    expect(bindingProblem(fields, C, withExtra(false))).toBeNull();
    expect(bindingProblem(fields, C, withExtra(true))).toEqual({
      field: 'kind',
    });
  });

  it('прив’язаний вибір бере значення з поля запису, а не з довідника', () => {
    const extra: FieldSchema = {
      key: 'kind',
      label: 'Тип',
      type: 'enum',
      dictionary: 'task_type',
      create: true,
      source: 'extra',
    };
    const schema = publishSchema(TASK_SCHEMA, [extra]);
    const kind = (dictionary: string | null) => [
      ...taskBase,
      field({ key: 'kind', type: 'enum', binding: 'kind', dictionary }),
    ];
    expect(fieldsProblem(kind(null), C, schema, DICTS)).toBeNull();
    expect(fieldsProblem(kind('task_type'), C, schema, DICTS)).toEqual({
      field: 'kind',
    });
  });
});

it('довідники полів — без повторів', () => {
  expect(
    fieldDictionaries([
      field({ key: 'a', type: 'enum', dictionary: 'x' }),
      field({ key: 'b', type: 'list<enum>', dictionary: 'x' }),
      field({ key: 'c' }),
    ]),
  ).toEqual(['x']);
});
