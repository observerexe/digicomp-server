import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TASK_TEMPLATES } from '../migrations/1812000000000-TaskTemplates';
import { STARTER_TEMPLATES } from '../migrations/1809000000000-StarterTemplates';
import { publishSchema } from '../records/records.registry';
import { TASK_SCHEMA } from '../tasks/task.schema';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  fieldsProblem,
  type TemplateField,
} from './template-fields';
import { CreateTemplateDto, UpdateTemplateVersionDto } from './templates.dto';

/** The templates that create tasks keep every rule a version published from the constructor keeps. */
describe('шаблони ТЗ (міграція TaskTemplates)', () => {
  const schema = publishSchema(TASK_SCHEMA);

  it.each(TASK_TEMPLATES.map((t) => [t.title, t] as const))(
    '«%s»: налаштування, тіло й поля проходять перевірки публікації за схемою ТЗ',
    (_title, t) => {
      const settings = plainToInstance(CreateTemplateDto, {
        title: t.title,
        kind: TemplateKind.Creates,
        target: 'task',
        numberPrefix: 'ТЗ',
        autoFreeze: true,
        creators: 'staff',
        visibility: 'members',
      });
      expect(validateSync(settings)).toEqual([]);
      const version = plainToInstance(UpdateTemplateVersionDto, {
        revision: 1,
        body: t.body,
        fields: t.fields,
      });
      expect(validateSync(version)).toEqual([]);
      const fields = t.fields as TemplateField[];
      expect(
        fieldsProblem(fields, TemplateKind.Creates, schema, {
          dictionaries: new Set(),
          refTypes: new Set(['user', 'place']),
        }),
      ).toBeNull();
      expect(bodyProblem(t.body as never, fields)).toBeNull();
    },
  );

  it('ідентифікатори не повторюються й не збігаються з початковими шаблонами', () => {
    const ids = [...TASK_TEMPLATES, ...STARTER_TEMPLATES].flatMap((t) => [
      t.id,
      t.versionId,
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
