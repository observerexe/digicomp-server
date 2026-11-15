import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DISCIPLINE_TEMPLATES } from '../migrations/1813000000000-DisciplineTemplates';
import { STARTER_TEMPLATES } from '../migrations/1809000000000-StarterTemplates';
import { TASK_TEMPLATES } from '../migrations/1812000000000-TaskTemplates';
import { POINTS_TEMPLATES } from '../migrations/1815000000000-PointsTemplates';
import { POINTS_ENTRY_SCHEMA } from '../points/points-entry.schema';
import { publishSchema } from '../records/records.registry';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  fieldsProblem,
  recordRowsKey,
  rowColumns,
  type TemplateField,
} from './template-fields';
import { CreateTemplateDto, UpdateTemplateVersionDto } from './templates.dto';

/** «Відомість балів» keeps every rule a version published from the constructor keeps. */
describe('шаблон балів (міграція PointsTemplates)', () => {
  const schema = publishSchema(POINTS_ENTRY_SCHEMA);
  const [t] = POINTS_TEMPLATES;

  it('налаштування, тіло й поля проходять перевірки публікації', () => {
    const settings = plainToInstance(CreateTemplateDto, {
      title: t!.title,
      kind: t!.kind,
      target: t!.target,
      numberPrefix: t!.numberPrefix,
      autoFreeze: t!.autoFreeze,
      creators: t!.creators,
      visibility: 'author',
    });
    expect(validateSync(settings)).toEqual([]);
    const version = plainToInstance(UpdateTemplateVersionDto, {
      revision: 1,
      body: t!.body,
      fields: t!.fields,
    });
    expect(validateSync(version)).toEqual([]);
    const fields = t!.fields as TemplateField[];
    const columns = rowColumns(t!.body as never);
    expect(
      fieldsProblem(
        fields,
        TemplateKind.Creates,
        schema,
        { dictionaries: new Set(), refTypes: new Set(['user']) },
        columns,
      ),
    ).toBeNull();
    expect(bodyProblem(t!.body as never, fields)).toBeNull();
    // A row — an award.
    expect(recordRowsKey(fields, columns)).toBe('awards');
  });

  it('ідентифікатори не повторюються й не збігаються з іншими шаблонами з міграцій', () => {
    const ids = [
      ...POINTS_TEMPLATES,
      ...DISCIPLINE_TEMPLATES,
      ...TASK_TEMPLATES,
      ...STARTER_TEMPLATES,
    ].flatMap((x) => [x.id, x.versionId]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
