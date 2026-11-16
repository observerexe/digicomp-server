import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AUTHORIZATION_TEMPLATES } from '../migrations/1821000000000-AuthorizationTemplates';
import { DISCIPLINE_TEMPLATES } from '../migrations/1813000000000-DisciplineTemplates';
import { POINTS_TEMPLATES } from '../migrations/1815000000000-PointsTemplates';
import { REPORT_TEMPLATES } from '../migrations/1819000000000-ReportTemplates';
import { STARTER_TEMPLATES } from '../migrations/1809000000000-StarterTemplates';
import { TASK_TEMPLATES } from '../migrations/1812000000000-TaskTemplates';
import { PLACE_AUTHORIZATION_SCHEMA } from '../places/place-authorization.schema';
import { publishSchema } from '../records/records.registry';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  fieldsProblem,
  rowColumns,
  type TemplateField,
} from './template-fields';
import { CreateTemplateDto, UpdateTemplateVersionDto } from './templates.dto';

/** «Запис про інструктаж і допуск» keeps every rule a version published from the constructor keeps. */
describe('шаблон допуску (міграція AuthorizationTemplates)', () => {
  const schema = publishSchema(PLACE_AUTHORIZATION_SCHEMA);

  it.each(AUTHORIZATION_TEMPLATES.map((t) => [t.title, t] as const))(
    '«%s»: налаштування, тіло й поля проходять перевірки публікації',
    (_title, t) => {
      const settings = plainToInstance(CreateTemplateDto, {
        title: t.title,
        kind: t.kind,
        target: t.target,
        numberPrefix: t.numberPrefix,
        autoFreeze: t.autoFreeze,
        creators: t.creators,
        visibility: t.visibility,
      });
      expect(validateSync(settings)).toEqual([]);
      const version = plainToInstance(UpdateTemplateVersionDto, {
        revision: 1,
        body: t.body,
        fields: t.fields,
      });
      expect(validateSync(version)).toEqual([]);
      const fields = t.fields as TemplateField[];
      const body = t.body as never;
      expect(
        fieldsProblem(
          fields,
          TemplateKind.Creates,
          schema,
          {
            dictionaries: new Set(),
            refTypes: new Set(['user', 'place']),
          },
          rowColumns(body),
        ),
      ).toBeNull();
      expect(bodyProblem(body, fields)).toBeNull();
    },
  );

  it('учасник підписує «Інструктаж отримав»', () => {
    const signs = AUTHORIZATION_TEMPLATES[0]!.body.content!.find(
      (n) => n.type === 'signatures',
    );
    expect(signs?.attrs).toMatchObject({
      rightLabel: 'Інструктаж отримав',
      rightSigner: 'userId',
    });
  });

  it('ідентифікатори не повторюються й не збігаються з іншими шаблонами з міграцій', () => {
    const ids = [
      ...AUTHORIZATION_TEMPLATES,
      ...REPORT_TEMPLATES,
      ...POINTS_TEMPLATES,
      ...DISCIPLINE_TEMPLATES,
      ...TASK_TEMPLATES,
      ...STARTER_TEMPLATES,
    ].flatMap((x) => [x.id, x.versionId]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('префікс не збігається з іншими шаблонами з міграцій', () => {
    // «Технічне завдання» й «Коротке ТЗ» — `ТЗ` (міграція пише його в SQL).
    const prefixes = [
      'ТЗ',
      ...[
        ...AUTHORIZATION_TEMPLATES,
        ...REPORT_TEMPLATES,
        ...POINTS_TEMPLATES,
        ...DISCIPLINE_TEMPLATES,
        ...STARTER_TEMPLATES,
      ].flatMap((x) => (x.numberPrefix ? [x.numberPrefix] : [])),
    ];
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
