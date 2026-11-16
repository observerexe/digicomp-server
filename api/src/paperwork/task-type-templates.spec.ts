import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { slugify } from '../dictionaries/keys';
import { PALETTE } from '../dictionaries/palette';
import { TASK_TEMPLATES } from '../migrations/1812000000000-TaskTemplates';
import {
  TASK_TYPE_DICTIONARY,
  TASK_TYPE_FIELD,
  TASK_TYPE_OTHER,
  TASK_TYPES,
} from '../migrations/1825000000000-TaskTypes';
import { TASK_TYPE_TEMPLATES } from '../migrations/1826000000000-TaskTypeTemplates';
import { extraFieldSchema } from '../records/extra-values';
import { publishSchema } from '../records/records.registry';
import { TASK_SCHEMA } from '../tasks/task.schema';
import { TemplateKind } from './template.entities';
import {
  bindingProblem,
  bodyProblem,
  fieldsProblem,
  type TemplateField,
} from './template-fields';
import { UpdateTemplateVersionDto } from './templates.dto';

/** The task's schema with «Тип», as the migration TaskTypes adds it. */
const schema = publishSchema(TASK_SCHEMA, [
  extraFieldSchema({
    key: TASK_TYPE_FIELD.key,
    label: TASK_TYPE_FIELD.label,
    type: 'enum',
    required: true,
    dictionary: TASK_TYPE_DICTIONARY.key,
    min: null,
    max: null,
    maxLength: null,
    maxItems: null,
    archived: false,
  }),
]);

describe('типи ТЗ (міграції TaskTypes, TaskTypeTemplates)', () => {
  it('ключі пунктів — із назв, як їх робить сервер; кольори — з палітри; «Інше» є', () => {
    for (const t of TASK_TYPES) {
      expect(t.key).toBe(slugify(t.title));
      expect(PALETTE).toContain(t.color);
    }
    expect(TASK_TYPES.map((t) => t.key)).toContain(TASK_TYPE_OTHER);
    expect(new Set(TASK_TYPES.map((t) => t.key)).size).toBe(TASK_TYPES.length);
  });

  it.each(TASK_TYPE_TEMPLATES.map((t) => [t.title, t] as const))(
    '«%s», версія 2: тіло й поля проходять перевірки публікації за схемою ТЗ із «Типом»',
    (_title, t) => {
      const version = plainToInstance(UpdateTemplateVersionDto, {
        revision: 1,
        body: t.body,
        fields: t.fields,
      });
      expect(validateSync(version)).toEqual([]);
      const fields = t.fields as TemplateField[];
      expect(
        fieldsProblem(fields, TemplateKind.Creates, schema, {
          dictionaries: new Set([TASK_TYPE_DICTIONARY.key]),
          refTypes: new Set(['user', 'place']),
        }),
      ).toBeNull();
      expect(bodyProblem(t.body as never, fields)).toBeNull();
    },
  );

  it('«Тип» стоїть одразу після назви — і в полях, і в тексті', () => {
    for (const t of TASK_TYPE_TEMPLATES) {
      const keys = t.fields.map((f) => f.key);
      expect(keys[keys.indexOf('title') + 1]).toBe('type');
      const holds = (key: string) =>
        (t.body.content ?? []).findIndex((n) =>
          (n.content ?? []).some(
            (c) => c.type === 'field' && c.attrs?.key === key,
          ),
        );
      expect(holds('type')).toBe(holds('title') + 1);
    }
  });

  it('версія 1 без «Типу» потребує оновлення', () => {
    for (const t of TASK_TEMPLATES) {
      expect(
        bindingProblem(
          t.fields as TemplateField[],
          TemplateKind.Creates,
          schema,
        ),
      ).toEqual({ binding: 'type' });
    }
  });

  it('нові версії мають власні ідентифікатори', () => {
    const ids = [
      ...TASK_TEMPLATES.flatMap((t) => [t.id, t.versionId]),
      ...TASK_TYPE_TEMPLATES.map((t) => t.versionId),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
