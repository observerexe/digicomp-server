import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PROJECT_MATERIALS } from '../inventory/inventory.tables';
import { INVENTORY_WRITEOFF_SCHEMA } from '../inventory/inventory-writeoff.schema';
import { AUTHORIZATION_TEMPLATES } from '../migrations/1821000000000-AuthorizationTemplates';
import { DISCIPLINE_TEMPLATES } from '../migrations/1813000000000-DisciplineTemplates';
import { POINTS_TEMPLATES } from '../migrations/1815000000000-PointsTemplates';
import { PROJECT_INVENTORY_TEMPLATES } from '../migrations/1823000000000-ProjectInventoryTemplates';
import { REPORT_TEMPLATES } from '../migrations/1819000000000-ReportTemplates';
import { STARTER_TEMPLATES } from '../migrations/1809000000000-StarterTemplates';
import { TASK_TEMPLATES } from '../migrations/1812000000000-TaskTemplates';
import { PROJECT_SCHEMA } from '../projects/project.schema';
import { publishSchema } from '../records/records.registry';
import { PROJECT_TASKS } from '../tasks/task.tables';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  fieldsProblem,
  recordRowsKey,
  reportProblem,
  reportRecordKey,
  rowColumns,
  tableProblem,
  type TemplateField,
} from './template-fields';
import { CreateTemplateDto, UpdateTemplateVersionDto } from './templates.dto';

/** The sources the modules register, with the fields they take. */
const INPUTS = new Map<string, string>([
  ['project_materials', PROJECT_MATERIALS.input],
  ['project_tasks', PROJECT_TASKS.input],
]);

const SCHEMAS = {
  project: publishSchema(PROJECT_SCHEMA),
  inventory_writeoff: publishSchema(INVENTORY_WRITEOFF_SCHEMA),
};

/** «Паспорт проєкту», «Підсумковий звіт», «Акт списання» keep every rule a version published from the constructor keeps. */
describe('шаблони проєктів і складу (міграція ProjectInventoryTemplates)', () => {
  it.each(PROJECT_INVENTORY_TEMPLATES.map((t) => [t.title, t] as const))(
    '«%s»: налаштування, тіло, поля й авто-таблиці проходять перевірки публікації',
    (_title, t) => {
      const kind = t.kind as TemplateKind;
      const settings = plainToInstance(CreateTemplateDto, {
        title: t.title,
        kind,
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
          kind,
          SCHEMAS[t.target],
          {
            dictionaries: new Set(),
            refTypes: new Set(['user', 'project', 'inventory_item']),
          },
          rowColumns(body),
        ),
      ).toBeNull();
      expect(bodyProblem(body, fields)).toBeNull();
      expect(tableProblem(body, fields, INPUTS)).toBeNull();
      expect(reportProblem(body, fields, kind, t.target)).toBeNull();
    },
  );

  it('звіти беруть проєкт з поля «Проєкт», акт — рядок = списання', () => {
    const [passport, summary, act] = PROJECT_INVENTORY_TEMPLATES;
    expect(reportRecordKey(passport!.fields, 'project')).toBe('project');
    expect(reportRecordKey(summary!.fields, 'project')).toBe('project');
    expect(
      recordRowsKey(
        act!.fields as TemplateField[],
        rowColumns(act!.body as never),
      ),
    ).toBe('items');
  });

  const ALL = [
    ...PROJECT_INVENTORY_TEMPLATES,
    ...AUTHORIZATION_TEMPLATES,
    ...REPORT_TEMPLATES,
    ...POINTS_TEMPLATES,
    ...DISCIPLINE_TEMPLATES,
    ...TASK_TEMPLATES,
    ...STARTER_TEMPLATES,
  ];

  it('ідентифікатори не повторюються й не збігаються з іншими шаблонами з міграцій', () => {
    const ids = ALL.flatMap((x) => [x.id, x.versionId]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('префікси нових шаблонів не збігаються з іншими: лічильник номерів — один на префікс', () => {
    const others = new Set(
      ALL.filter((x) => !PROJECT_INVENTORY_TEMPLATES.includes(x as never)).map(
        (x) => x.numberPrefix,
      ),
    );
    const mine = PROJECT_INVENTORY_TEMPLATES.map((x) => x.numberPrefix);
    expect(mine.filter((p) => others.has(p))).toEqual([]);
    expect(new Set(mine).size).toBe(mine.length);
  });
});
