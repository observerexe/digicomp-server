import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FAULT_SCHEMA } from '../faults/fault.schema';
import { PLACE_FAULTS } from '../faults/fault.tables';
import { DISCIPLINE_TEMPLATES } from '../migrations/1813000000000-DisciplineTemplates';
import { POINTS_TEMPLATES } from '../migrations/1815000000000-PointsTemplates';
import { REPORT_TEMPLATES } from '../migrations/1819000000000-ReportTemplates';
import { STARTER_TEMPLATES } from '../migrations/1809000000000-StarterTemplates';
import { TASK_TEMPLATES } from '../migrations/1812000000000-TaskTemplates';
import { PLACE_SCHEMA } from '../places/place.schema';
import { PLACE_AUTHORIZATIONS, PLACE_SESSIONS } from '../places/place.tables';
import { pointsMonthTable } from '../points/points.tables';
import type { PointsService } from '../points/points.service';
import { publishSchema } from '../records/records.registry';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  fieldsProblem,
  reportProblem,
  reportRecordKey,
  rowColumns,
  tableProblem,
  type TemplateField,
} from './template-fields';
import { CreateTemplateDto, UpdateTemplateVersionDto } from './templates.dto';

/** The sources the modules register, with the fields they take. */
const INPUTS = new Map<string, string>([
  ['place_authorizations', PLACE_AUTHORIZATIONS.input],
  ['place_faults', PLACE_FAULTS.input],
  ['place_sessions', PLACE_SESSIONS.input],
  ['points_month', pointsMonthTable({} as PointsService).input],
]);

const SCHEMAS = {
  place: publishSchema(PLACE_SCHEMA),
  fault: publishSchema(FAULT_SCHEMA),
};

/** «Паспорт обладнання», «Акт несправності», «Рейтинг за місяць» keep every rule a version published from the constructor keeps. */
describe('шаблони звітів (міграція ReportTemplates)', () => {
  it.each(REPORT_TEMPLATES.map((t) => [t.title, t] as const))(
    '«%s»: налаштування, тіло, поля й авто-таблиці проходять перевірки публікації',
    (_title, t) => {
      const kind = t.kind as TemplateKind;
      const settings = plainToInstance(CreateTemplateDto, {
        title: t.title,
        kind,
        ...(t.target ? { target: t.target } : {}),
        numberPrefix: t.numberPrefix,
        autoFreeze: false,
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
          kind,
          t.target ? SCHEMAS[t.target] : null,
          {
            dictionaries: new Set(),
            refTypes: new Set(['user', 'place', 'fault']),
          },
          rowColumns(body),
        ),
      ).toBeNull();
      expect(bodyProblem(body, fields)).toBeNull();
      expect(tableProblem(body, fields, INPUTS)).toBeNull();
      expect(reportProblem(body, fields, kind, t.target)).toBeNull();
    },
  );

  it('звіт бере запис з першого поля свого типу', () => {
    const [passport, act] = REPORT_TEMPLATES;
    expect(reportRecordKey(passport!.fields, 'place')).toBe('place');
    expect(reportRecordKey(act!.fields, 'fault')).toBe('fault');
  });

  it('ідентифікатори не повторюються й не збігаються з іншими шаблонами з міграцій', () => {
    const ids = [
      ...REPORT_TEMPLATES,
      ...POINTS_TEMPLATES,
      ...DISCIPLINE_TEMPLATES,
      ...TASK_TEMPLATES,
      ...STARTER_TEMPLATES,
    ].flatMap((x) => [x.id, x.versionId]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
