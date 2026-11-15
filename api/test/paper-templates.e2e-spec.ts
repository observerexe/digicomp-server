import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

type Version = {
  number: number;
  revision: number;
  publishedAt: string | null;
  publishedBy: { id: string } | null;
  body?: unknown;
  fields?: Field[];
  schemaVersion?: string | null;
  documents?: number | null;
};
type Template = {
  id: string;
  title: string;
  kind: string;
  target: string | null;
  numberPrefix: string | null;
  autoFreeze: boolean;
  creators: string;
  visibility: string;
  archived: boolean;
  currentVersion: number | null;
  draftVersion: number | null;
  needsUpdate: boolean;
  versions?: Version[];
};
type Field = Record<string, unknown> & { key: string };

const field = (key: string, over: Record<string, unknown> = {}): Field => ({
  key,
  label: key,
  type: 'text',
  required: false,
  fill: 'author',
  editable: false,
  print: true,
  ...over,
});
/** Everything a task needs: title and points. */
const TASK_FIELDS = [
  field('title', { binding: 'title', required: true }),
  field('points', {
    type: 'int',
    binding: 'points',
    required: true,
    min: 0,
    max: 100,
  }),
];
const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
/** A body with every field: a line «label: [field]» each, a zone for `richtext`. */
const form = (title: string, fields: Field[]) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: title }] },
    ...fields.map((f) =>
      f.type === 'richtext'
        ? {
            type: 'fieldZone',
            attrs: { key: f.key },
            content: [{ type: 'paragraph' }],
          }
        : {
            type: 'paragraph',
            content: [
              { type: 'text', text: `${f.label as string}: ` },
              { type: 'field', attrs: { key: f.key } },
            ],
          },
    ),
  ],
});

describe('Шаблони документів (e2e)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
  });

  const T = '/api/papers/templates';
  const create = async (u: TestUser, dto: object) =>
    (await as(app, u).post(T).send(dto).expect(201)).body as Template;
  const save = (u: TestUser, id: string, n: number, dto: object) =>
    as(app, u).patch(`${T}/${id}/versions/${n}`).send(dto);
  const publish = (u: TestUser, id: string, n: number) =>
    as(app, u).post(`${T}/${id}/versions/${n}/publish`);
  /** A published task template open to all: version 1. */
  const taskTemplate = async (over: object = {}) => {
    const t = await create(mod, {
      title: 'Технічне завдання',
      kind: 'creates',
      target: 'task',
      creators: 'all',
      ...over,
    });
    await save(mod, t.id, 1, {
      revision: 1,
      fields: TASK_FIELDS,
      body: form('ТЗ', TASK_FIELDS),
    }).expect(200);
    await publish(mod, t.id, 1).expect(201);
    return t;
  };
  const audit = (action: string, entityId: string) =>
    app
      .get(DataSource)
      .getRepository(AuditLog)
      .findBy({ action, entity: 'paper_template', entityId });

  describe('створення', () => {
    it('з порожньою чернеткою версії 1; аудит', async () => {
      const t = await create(mod, {
        title: ' Протокол ',
        kind: 'free',
        numberPrefix: 'ПР',
      });
      expect(t).toMatchObject({
        title: 'Протокол',
        kind: 'free',
        target: null,
        numberPrefix: 'ПР',
        autoFreeze: false,
        creators: 'staff',
        visibility: 'author',
        archived: false,
        currentVersion: null,
        draftVersion: 1,
        needsUpdate: false,
      });
      expect(t.versions).toEqual([
        expect.objectContaining({
          number: 1,
          revision: 1,
          publishedAt: null,
          publishedBy: null,
        }),
      ]);
      const v = (await as(app, mod).get(`${T}/${t.id}/versions/1`).expect(200))
        .body as Version;
      expect(v.fields).toEqual([]);
      expect(v.body).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
      expect(await audit('paper_template.created', t.id)).toHaveLength(1);
    });

    it.each([
      ['вільний з типом запису', { kind: 'free', target: 'task' }],
      ['звіт без типу запису', { kind: 'report' }],
      [
        'створює запис, якого не створюють (сеанс)',
        { kind: 'creates', target: 'session' },
      ],
      [
        'автофіксація не для того, що створює запис',
        { kind: 'report', target: 'place', autoFreeze: true },
      ],
    ])('%s — TEMPLATE_KIND_INVALID', async (_n, dto) => {
      const res = await as(app, mod)
        .post(T)
        .send({ title: 'x', ...dto })
        .expect(400);
      expect(res.body.errorCode).toBe('TEMPLATE_KIND_INVALID');
    });

    it('префікс номера — великі літери й цифри', async () => {
      await as(app, mod)
        .post(T)
        .send({ title: 'x', kind: 'free', numberPrefix: 'тз' })
        .expect(400);
    });

    it('учасник не створює', async () => {
      await as(app, member)
        .post(T)
        .send({ title: 'x', kind: 'free' })
        .expect(403);
    });
  });

  describe('чернетка версії', () => {
    it('збереження з revision; застаріле — PAPER_CONFLICT; без змін revision не росте', async () => {
      const t = await create(mod, { title: 'x', kind: 'free' });
      const saved = (
        await save(mod, t.id, 1, {
          revision: 1,
          body: body('a'),
          fields: [field('note')],
        }).expect(200)
      ).body as Version;
      expect(saved.revision).toBe(2);
      expect(saved.body).toBeUndefined();
      const res = await save(admin, t.id, 1, {
        revision: 1,
        body: body('b'),
      }).expect(409);
      expect(res.body.errorCode).toBe('PAPER_CONFLICT');
      expect(
        (await save(mod, t.id, 1, { revision: 2 }).expect(200)).body.revision,
      ).toBe(2);
      const v = (await as(app, mod).get(`${T}/${t.id}/versions/1`).expect(200))
        .body as Version;
      expect(v.body).toEqual(body('a'));
      expect(v.fields).toEqual([
        {
          ...field('note'),
          binding: null,
          min: null,
          max: null,
          maxLength: null,
          maxItems: null,
          dictionary: null,
        },
      ]);
    });

    it('незавершене поле зберігається (перевірка — під час публікації)', async () => {
      const t = await create(mod, { title: 'x', kind: 'free' });
      await save(mod, t.id, 1, {
        revision: 1,
        fields: [field('kind', { type: 'enum' })],
      }).expect(200);
      const res = await publish(mod, t.id, 1).expect(400);
      expect(res.body).toMatchObject({
        errorCode: 'TEMPLATE_FIELD_INVALID',
        field: 'kind',
      });
    });

    it('форма перевіряється одразу: повтор ключа, невідомий тип, ключ не латиницею, вміст', async () => {
      const t = await create(mod, { title: 'x', kind: 'free' });
      const dup = await save(mod, t.id, 1, {
        revision: 1,
        fields: [field('a'), field('a')],
      }).expect(400);
      expect(dup.body).toMatchObject({
        errorCode: 'TEMPLATE_FIELD_INVALID',
        field: 'a',
      });
      await save(mod, t.id, 1, {
        revision: 1,
        fields: [field('a', { type: 'number' })],
      }).expect(400);
      await save(mod, t.id, 1, {
        revision: 1,
        fields: [field('Назва')],
      }).expect(400);
      await save(mod, t.id, 1, {
        revision: 1,
        fields: [{ ...field('a'), extra: 1 }],
      }).expect(400);
      await save(mod, t.id, 1, {
        revision: 1,
        body: { type: 'doc', content: [{ type: 'script' }] },
      }).expect(400);
    });

    it('відкинути чернетку; аудит', async () => {
      const t = await create(mod, { title: 'x', kind: 'free' });
      await as(app, mod).delete(`${T}/${t.id}/versions/1`).expect(200);
      expect(
        (await as(app, mod).get(`${T}/${t.id}`).expect(200)).body.draftVersion,
      ).toBeNull();
      expect(await audit('paper_template.draft_discarded', t.id)).toHaveLength(
        1,
      );
      const again = (
        await as(app, mod).post(`${T}/${t.id}/versions`).expect(201)
      ).body as Version;
      expect(again).toMatchObject({ number: 1, fields: [] });
    });
  });

  describe('публікація', () => {
    it('версія стає поточною й незмінною; запам’ятовує схему; аудит', async () => {
      const t = await taskTemplate();
      const got = (await as(app, mod).get(`${T}/${t.id}`).expect(200))
        .body as Template;
      expect(got).toMatchObject({
        currentVersion: 1,
        draftVersion: null,
        needsUpdate: false,
      });
      expect(got.versions![0].publishedBy).toMatchObject({ id: mod.id });
      const schema = (
        await as(app, mod).get('/api/records/task/schema').expect(200)
      ).body as { version: string };
      const v = (await as(app, mod).get(`${T}/${t.id}/versions/1`).expect(200))
        .body as Version;
      expect(v.schemaVersion).toBe(schema.version);

      for (const res of [
        await save(mod, t.id, 1, { revision: 2, body: body('змінено') }),
        await publish(mod, t.id, 1),
        await as(app, mod).delete(`${T}/${t.id}/versions/1`),
        await as(app, mod).delete(`${T}/${t.id}`),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.errorCode).toBe('TEMPLATE_VERSION_PUBLISHED');
      }
      expect(
        (await audit('paper_template.published', t.id))[0].meta,
      ).toMatchObject({ version: 1 });
    });

    it('нова чернетка — копія поточної, номер 2; повторний запит дає ту саму', async () => {
      const t = await taskTemplate();
      const v2 = (await as(app, mod).post(`${T}/${t.id}/versions`).expect(201))
        .body as Version;
      expect(v2).toMatchObject({
        number: 2,
        publishedAt: null,
        body: form('ТЗ', TASK_FIELDS),
      });
      expect(v2.fields!.map((f) => f.key)).toEqual(['title', 'points']);
      expect(
        (
          (await as(app, mod).post(`${T}/${t.id}/versions`).expect(201))
            .body as Version
        ).number,
      ).toBe(2);
      await save(mod, t.id, 2, {
        revision: 1,
        body: form('ТЗ v2', TASK_FIELDS),
      }).expect(200);
      await publish(mod, t.id, 2).expect(201);
      const got = (await as(app, mod).get(`${T}/${t.id}`).expect(200))
        .body as Template;
      expect(got.currentVersion).toBe(2);
      expect(got.versions!.map((v) => v.number)).toEqual([2, 1]);
    });

    it('тіло звіряється з полями: кожне поле в тілі, зона — для richtext і одна, без невідомих ключів', async () => {
      const t = await create(mod, { title: 'x', kind: 'free' });
      const fields = [field('name'), field('goal', { type: 'richtext' })];
      const cases: [unknown, string][] = [
        // Поля «goal» у тілі немає.
        [form('x', [fields[0]]), 'goal'],
        // Невідомий ключ.
        [form('x', [...fields, field('ghost')]), 'ghost'],
        // richtext — не вбудоване поле.
        [form('x', [fields[0], { ...fields[1], type: 'text' }]), 'goal'],
        // Звичайне поле — не зона.
        [form('x', [{ ...fields[0], type: 'richtext' }, fields[1]]), 'name'],
        // Зона двічі.
        [form('x', [...fields, fields[1]]), 'goal'],
        // Поле всередині зони.
        [
          {
            type: 'doc',
            content: [
              {
                type: 'fieldZone',
                attrs: { key: 'goal' },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'field', attrs: { key: 'name' } }],
                  },
                ],
              },
            ],
          },
          'name',
        ],
      ];
      let revision = 1;
      for (const [b, key] of cases) {
        revision = (
          await save(mod, t.id, 1, { revision, fields, body: b }).expect(200)
        ).body.revision;
        expect((await publish(mod, t.id, 1).expect(400)).body).toMatchObject({
          errorCode: 'TEMPLATE_FIELD_INVALID',
          field: key,
        });
      }
      // Поле може стояти в тілі кілька разів.
      await save(mod, t.id, 1, {
        revision,
        fields,
        body: form('x', [fields[0], ...fields]),
      }).expect(200);
      await publish(mod, t.id, 1).expect(201);
    });

    it('зона, прив’язана до текстового поля запису, починається простими абзацами', async () => {
      const t = await create(mod, {
        title: 'x',
        kind: 'creates',
        target: 'task',
      });
      const fields = [
        ...TASK_FIELDS,
        field('goal', { type: 'richtext', binding: 'description' }),
      ];
      const b = form('ТЗ', fields);
      const zone = b.content[b.content.length - 1] as { content: unknown[] };
      zone.content = [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'а', marks: [{ type: 'bold' }] }],
        },
      ];
      await save(mod, t.id, 1, { revision: 1, fields, body: b }).expect(200);
      expect((await publish(mod, t.id, 1).expect(400)).body).toMatchObject({
        field: 'goal',
      });
      zone.content = [
        { type: 'paragraph', content: [{ type: 'text', text: 'а' }] },
      ];
      await save(mod, t.id, 1, { revision: 2, body: b }).expect(200);
      await publish(mod, t.id, 1).expect(201);
    });

    it('без потрібного поля запису — TEMPLATE_FIELD_INVALID з ключем поля запису', async () => {
      const t = await create(mod, {
        title: 'x',
        kind: 'creates',
        target: 'task',
      });
      await save(mod, t.id, 1, {
        revision: 1,
        fields: [TASK_FIELDS[0]],
      }).expect(200);
      const res = await publish(mod, t.id, 1).expect(400);
      expect(res.body).toMatchObject({
        errorCode: 'TEMPLATE_FIELD_INVALID',
        binding: 'points',
      });
    });

    it('межі ширші, ніж у запису, — TEMPLATE_FIELD_INVALID з ключем поля', async () => {
      const t = await create(mod, {
        title: 'x',
        kind: 'creates',
        target: 'task',
      });
      const wide = [
        TASK_FIELDS[0],
        field('points', {
          type: 'int',
          binding: 'points',
          required: true,
          max: 5000,
        }),
      ];
      await save(mod, t.id, 1, { revision: 1, fields: wide }).expect(200);
      expect((await publish(mod, t.id, 1).expect(400)).body).toMatchObject({
        field: 'points',
      });
    });

    it('вибір з довідника: довідник має існувати, а опублікований шаблон його тримає', async () => {
      const dict = (
        await as(app, mod)
          .post('/api/dictionaries')
          .send({ title: 'Важливість' })
          .expect(201)
      ).body as { key: string };
      const t = await create(mod, { title: 'x', kind: 'free' });
      await save(mod, t.id, 1, {
        revision: 1,
        fields: [field('level', { type: 'enum', dictionary: 'nope' })],
      }).expect(200);
      expect((await publish(mod, t.id, 1).expect(400)).body).toMatchObject({
        field: 'level',
      });
      const level = [field('level', { type: 'enum', dictionary: dict.key })];
      await save(mod, t.id, 1, {
        revision: 2,
        fields: level,
        body: form('x', level),
      }).expect(200);
      await publish(mod, t.id, 1).expect(201);
      const res = await as(app, mod)
        .delete(`/api/dictionaries/${dict.key}`)
        .expect(409);
      expect(res.body.errorCode).toBe('DICTIONARY_IN_USE');
    });
  });

  describe('спроба в конструкторі', () => {
    it('поля чернетки — як їх заповнює документ: межі запису, варіанти довідника; учаснику — ні', async () => {
      const dict = (
        await as(app, mod)
          .post('/api/dictionaries')
          .send({ title: 'Важливість' })
          .expect(201)
      ).body as { key: string };
      await as(app, mod)
        .post(`/api/dictionaries/${dict.key}/items`)
        .send({ title: 'Висока' })
        .expect(201);
      const t = await create(mod, {
        title: 'ТЗ',
        kind: 'creates',
        target: 'task',
      });
      await save(mod, t.id, 1, {
        revision: 1,
        fields: [
          field('points', { type: 'int', binding: 'points', min: 5 }),
          field('level', { type: 'enum', dictionary: dict.key }),
          field('who', { type: 'ref:user', fill: 'staff' }),
        ],
      }).expect(200);

      const got = (
        await as(app, mod).get(`${T}/${t.id}/versions/1/fields`).expect(200)
      ).body as {
        version: number;
        fields: (Field & { canFill: boolean })[];
      };
      expect(got.version).toBe(1);
      const [points, level, who] = got.fields;
      expect(points).toMatchObject({ min: 5, max: 1000, canFill: true });
      expect(level.options).toEqual([
        expect.objectContaining({ label: 'Висока' }),
      ]);
      expect(who).toMatchObject({ fill: 'staff', canFill: true });

      await as(app, member).get(`${T}/${t.id}/versions/1/fields`).expect(403);
      await as(app, mod).get(`${T}/${t.id}/versions/9/fields`).expect(404);
    });

    it('у списку версій — скільки документів на кожній; учаснику — null', async () => {
      const t = await taskTemplate();
      await as(app, member)
        .post('/api/papers')
        .send({ templateId: t.id })
        .expect(201);
      await as(app, mod).post(`${T}/${t.id}/versions`).expect(201);
      const got = (await as(app, mod).get(`${T}/${t.id}`).expect(200))
        .body as Template;
      expect(got.versions!.map((v) => v.documents)).toEqual([0, 1]);
      const seen = (await as(app, member).get(`${T}/${t.id}`).expect(200))
        .body as Template;
      expect(seen.versions!.map((v) => v.documents)).toEqual([null]);
    });
  });

  describe('потребує оновлення', () => {
    it('прив’язане додаткове поле пішло в архів — мітка; нова версія її знімає', async () => {
      const dict = (
        await as(app, mod)
          .post('/api/dictionaries')
          .send({ title: 'Тип ТЗ' })
          .expect(201)
      ).body as { key: string };
      const def = (
        await as(app, mod)
          .post('/api/records/task/field-defs')
          .send({ label: 'Тип', type: 'enum', dictionary: dict.key })
          .expect(201)
      ).body as { key: string };
      const t = await create(mod, {
        title: 'ТЗ',
        kind: 'creates',
        target: 'task',
      });
      const v1 = [
        ...TASK_FIELDS,
        field('kind', { type: 'enum', binding: def.key }),
      ];
      await save(mod, t.id, 1, {
        revision: 1,
        fields: v1,
        body: form('ТЗ', v1),
      }).expect(200);
      await publish(mod, t.id, 1).expect(201);

      // Схема змінилась, але прив’язки цілі — мітки немає.
      await as(app, mod)
        .post('/api/records/task/field-defs')
        .send({ label: 'Складність', type: 'int' })
        .expect(201);
      expect(
        (await as(app, mod).get(`${T}/${t.id}`).expect(200)).body.needsUpdate,
      ).toBe(false);

      await as(app, mod)
        .patch(`/api/records/task/field-defs/${def.key}`)
        .send({ archived: true })
        .expect(200);
      const list = (await as(app, mod).get(T).expect(200)).body as Template[];
      expect(list.find((x) => x.id === t.id)?.needsUpdate).toBe(true);

      const v2 = (await as(app, mod).post(`${T}/${t.id}/versions`).expect(201))
        .body as Version;
      expect((await publish(mod, t.id, 2).expect(400)).body).toMatchObject({
        field: 'kind',
      });
      await save(mod, t.id, 2, {
        revision: v2.revision,
        fields: TASK_FIELDS,
        body: form('ТЗ', TASK_FIELDS),
      }).expect(200);
      await publish(mod, t.id, 2).expect(201);
      expect(
        (await as(app, mod).get(`${T}/${t.id}`).expect(200)).body.needsUpdate,
      ).toBe(false);
    });
  });

  describe('зміна шаблону', () => {
    it('змінює лише передане; вид і тип запису — ні; аудит зі змінами', async () => {
      const t = await taskTemplate();
      const res = (
        await as(app, admin)
          .patch(`${T}/${t.id}`)
          .send({
            title: 'ТЗ',
            numberPrefix: 'ТЗ',
            autoFreeze: true,
            visibility: 'members',
          })
          .expect(200)
      ).body as Template;
      expect(res).toMatchObject({
        title: 'ТЗ',
        numberPrefix: 'ТЗ',
        autoFreeze: true,
        visibility: 'members',
        kind: 'creates',
        target: 'task',
      });
      await as(app, admin)
        .patch(`${T}/${t.id}`)
        .send({ kind: 'free' })
        .expect(400);
      const [log] = await audit('paper_template.updated', t.id);
      expect(log.meta).toMatchObject({
        changes: { title: { from: 'Технічне завдання', to: 'ТЗ' } },
      });
      expect(
        (
          await as(app, admin)
            .patch(`${T}/${t.id}`)
            .send({ numberPrefix: null })
            .expect(200)
        ).body.numberPrefix,
      ).toBeNull();
    });

    it('автофіксація у вільного — TEMPLATE_KIND_INVALID', async () => {
      const t = await create(mod, { title: 'x', kind: 'free' });
      const res = await as(app, mod)
        .patch(`${T}/${t.id}`)
        .send({ autoFreeze: true })
        .expect(400);
      expect(res.body.errorCode).toBe('TEMPLATE_KIND_INVALID');
    });

    it('видалити можна неопублікований; аудит', async () => {
      const t = await create(mod, { title: 'x', kind: 'free' });
      await as(app, mod).delete(`${T}/${t.id}`).expect(200);
      expect(
        (await as(app, mod).get(`${T}/${t.id}`).expect(404)).body.errorCode,
      ).toBe('TEMPLATE_NOT_FOUND');
      expect(await audit('paper_template.deleted', t.id)).toHaveLength(1);
    });
  });

  describe('що бачить учасник', () => {
    it('лише опубліковані, відкриті для всіх, не в архіві; лише поточну версію', async () => {
      const open = await taskTemplate();
      const staffOnly = await taskTemplate({
        title: 'Лише модератори',
        creators: 'staff',
      });
      const unpublished = await create(mod, {
        title: 'Чернетка',
        kind: 'free',
        creators: 'all',
      });
      const archived = await taskTemplate({ title: 'Старе' });
      await as(app, mod)
        .patch(`${T}/${archived.id}`)
        .send({ archived: true })
        .expect(200);
      await as(app, mod).post(`${T}/${open.id}/versions`).expect(201);

      const list = (await as(app, member).get(T).expect(200))
        .body as Template[];
      expect(list.map((x) => x.title)).toEqual(['Технічне завдання']);
      expect(list[0].draftVersion).toBeNull();
      expect(
        ((await as(app, mod).get(T).expect(200)).body as Template[])
          .map((x) => x.title)
          .sort(),
      ).toEqual(
        ['Лише модератори', 'Старе', 'Технічне завдання', 'Чернетка'].sort(),
      );

      const got = (await as(app, member).get(`${T}/${open.id}`).expect(200))
        .body as Template;
      expect(got.versions!.map((v) => v.number)).toEqual([1]);
      expect(got.draftVersion).toBeNull();
      await as(app, member).get(`${T}/${open.id}/versions/1`).expect(200);
      await as(app, member).get(`${T}/${open.id}/versions/2`).expect(404);
      for (const id of [staffOnly.id, unpublished.id, archived.id]) {
        await as(app, member).get(`${T}/${id}`).expect(404);
        await as(app, member).get(`${T}/${id}/versions/1`).expect(404);
      }
    });

    it('учасник не змінює й не публікує', async () => {
      const t = await create(mod, {
        title: 'x',
        kind: 'free',
        creators: 'all',
      });
      await as(app, member)
        .patch(`${T}/${t.id}`)
        .send({ title: 'y' })
        .expect(403);
      await as(app, member).post(`${T}/${t.id}/versions`).expect(403);
      await save(member, t.id, 1, { revision: 1, body: body('x') }).expect(403);
      await as(app, member).delete(`${T}/${t.id}/versions/1`).expect(403);
      await publish(member, t.id, 1).expect(403);
      await as(app, member).delete(`${T}/${t.id}`).expect(403);
    });
  });

  it('/papers/templates не плутається з /papers/:id', async () => {
    await as(app, member).get(T).expect(200);
    await as(app, member).get('/api/papers/not-a-uuid').expect(400);
  });
});
