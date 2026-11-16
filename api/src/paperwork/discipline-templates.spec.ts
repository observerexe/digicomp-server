import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DISCIPLINE_RECORD_SCHEMA } from '../discipline/discipline-record.schema';
import { DISCIPLINE_TEMPLATES } from '../migrations/1813000000000-DisciplineTemplates';
import { STARTER_TEMPLATES } from '../migrations/1809000000000-StarterTemplates';
import { TASK_TEMPLATES } from '../migrations/1812000000000-TaskTemplates';
import { publishSchema } from '../records/records.registry';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  conditionProblem,
  fieldsProblem,
  isAutoBinding,
  type TemplateField,
} from './template-fields';
import { CreateTemplateDto, UpdateTemplateVersionDto } from './templates.dto';

/** The discipline templates keep every rule a version published from the constructor keeps. */
describe('шаблони дисципліни (міграція DisciplineTemplates)', () => {
  const schema = publishSchema(DISCIPLINE_RECORD_SCHEMA);

  it.each(DISCIPLINE_TEMPLATES.map((t) => [t.title, t] as const))(
    '«%s»: налаштування, тіло й поля проходять перевірки публікації',
    (_title, t) => {
      const kind = t.kind as TemplateKind;
      const target = kind === TemplateKind.Creates ? schema : null;
      const settings = plainToInstance(CreateTemplateDto, {
        title: t.title,
        kind,
        ...(t.target ? { target: t.target } : {}),
        ...(t.numberPrefix ? { numberPrefix: t.numberPrefix } : {}),
        autoFreeze: t.autoFreeze,
        creators: t.creators,
        visibility: 'author',
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
        fieldsProblem(fields, kind, target, {
          dictionaries: new Set(),
          refTypes: new Set(['user', 'discipline_record']),
        }),
      ).toBeNull();
      expect(bodyProblem(t.body as never, fields)).toBeNull();
      // Choices of a bound enum come from the record's schema.
      const bound = new Map((target?.fields ?? []).map((s) => [s.key, s]));
      const resolved = fields.map((f) => {
        const s = f.binding ? bound.get(f.binding) : undefined;
        return {
          key: f.key,
          type: f.type,
          binding: f.binding,
          auto: !!s && isAutoBinding(kind, s),
          options: f.type === 'enum' ? (s?.options ?? []) : null,
        };
      });
      expect(conditionProblem(t.body as never, resolved, target)).toBeNull();
    },
  );

  it('ідентифікатори не повторюються й не збігаються з іншими шаблонами з міграцій', () => {
    const ids = [
      ...DISCIPLINE_TEMPLATES,
      ...TASK_TEMPLATES,
      ...STARTER_TEMPLATES,
    ].flatMap((t) => [t.id, t.versionId]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
