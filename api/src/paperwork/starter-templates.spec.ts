import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { STARTER_TEMPLATES } from '../migrations/1809000000000-StarterTemplates';
import { TemplateKind } from './template.entities';
import {
  bodyProblem,
  fieldsProblem,
  type TemplateField,
} from './template-fields';
import { CreateTemplateDto, UpdateTemplateVersionDto } from './templates.dto';

/** The templates the migration publishes keep every rule a version published from the constructor keeps. */
describe('початкові шаблони (міграція StarterTemplates)', () => {
  it.each(STARTER_TEMPLATES.map((t) => [t.title, t] as const))(
    '«%s»: налаштування, тіло й поля проходять перевірки публікації',
    (_title, t) => {
      const settings = plainToInstance(CreateTemplateDto, {
        title: t.title,
        kind: TemplateKind.Free,
        numberPrefix: t.numberPrefix,
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
      expect(
        fieldsProblem(fields, TemplateKind.Free, null, {
          dictionaries: new Set(),
          // Types a picker finds (LinkRegistry): the starters refer to members and equipment.
          refTypes: new Set(['user', 'place']),
        }),
      ).toBeNull();
      expect(bodyProblem(t.body as never, fields)).toBeNull();
    },
  );

  it('ідентифікатори й назви не повторюються', () => {
    const ids = STARTER_TEMPLATES.flatMap((t) => [t.id, t.versionId]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(STARTER_TEMPLATES.map((t) => t.title)).size).toBe(
      STARTER_TEMPLATES.length,
    );
  });
});
