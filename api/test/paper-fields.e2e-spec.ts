import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

// Документи з шаблону (2.2а): створення з поточної версії, значення полів,
// заблокований текст поза зонами, поля «заповнює модератор», друк, копія.

type Field = Record<string, unknown> & { key: string; type: string };
type PaperField = Field & {
  options: { key: string; label: string; archived?: boolean }[] | null;
  canFill: boolean;
  plain: boolean;
  min: number | null;
  max: number | null;
  maxLength: number | null;
};
type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: { type: string }[];
};
type Paper = {
  id: string;
  title: string;
  visibility: string;
  revision: number;
  content: Node;
  values: Record<string, unknown>;
  template: {
    id: string;
    title: string;
    version: number;
    fields: PaperField[];
  } | null;
  canEdit: boolean;
};

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

/** A body with every field: a line «label: [field]» each, a zone for `richtext`. */
const form = (title: string, fields: Field[]): Node => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: title }] },
    ...fields.map((f): Node =>
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

/** The content with the zone `key` holding these paragraphs. */
const withZone = (doc: Node, key: string, paragraphs: Node[]): Node => ({
  ...doc,
  content: doc.content!.map((n) =>
    n.type === 'fieldZone' && n.attrs?.key === key
      ? { ...n, content: paragraphs }
      : n,
  ),
});
const para = (text: string, marks?: { type: string }[]): Node => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});

describe('Документи з шаблону (e2e)', () => {
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
  /** A published template; returns its id. */
  const template = async (
    fields: Field[],
    over: Record<string, unknown> = {},
    body: Node = form('Заява', fields),
  ) => {
    const t = (
      await as(app, mod)
        .post(T)
        .send({ title: 'Заява', kind: 'free', creators: 'all', ...over })
        .expect(201)
    ).body as { id: string };
    await as(app, mod)
      .patch(`${T}/${t.id}/versions/1`)
      .send({ revision: 1, fields, body })
      .expect(200);
    await as(app, mod).post(`${T}/${t.id}/versions/1/publish`).expect(201);
    return t.id;
  };
  const fromTemplate = async (u: TestUser, templateId: string) =>
    (await as(app, u).post('/api/papers').send({ templateId }).expect(201))
      .body as Paper;
  const save = (u: TestUser, p: Paper, body: object) =>
    as(app, u)
      .patch(`/api/papers/${p.id}`)
      .send({ revision: p.revision, ...body });
  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const dictionary = async (title: string, items: string[]) => {
    const d = (
      await as(app, mod).post('/api/dictionaries').send({ title }).expect(201)
    ).body as { key: string };
    const keys: string[] = [];
    for (const i of items) {
      keys.push(
        (
          await as(app, mod)
            .post(`/api/dictionaries/${d.key}/items`)
            .send({ title: i })
            .expect(201)
        ).body.key as string,
      );
    }
    return { key: d.key, items: keys };
  };

  describe('створення з шаблону', () => {
    it('вміст — тіло поточної версії, назва й видимість — з шаблону; аудит', async () => {
      const fields = [field('name'), field('goal', { type: 'richtext' })];
      const id = await template(fields, { visibility: 'members' });
      const p = await fromTemplate(member, id);
      expect(p).toMatchObject({
        title: 'Заява',
        visibility: 'members',
        values: {},
        content: form('Заява', fields),
        canEdit: true,
        template: { id, title: 'Заява', version: 1 },
      });
      expect(p.template!.fields.map((f) => [f.key, f.canFill])).toEqual([
        ['name', true],
        ['goal', true],
      ]);
      const [log] = await app
        .get(DataSource)
        .getRepository(AuditLog)
        .findBy({ action: 'paper.created', entityId: p.id });
      expect(log.meta).toMatchObject({ templateId: id, version: 1 });
    });

    it('межі — тісніші з шаблону й поля запису; вибір — з довідника чи схеми', async () => {
      const d = await dictionary('Важливість', ['Висока', 'Низька']);
      const fields = [
        field('title', { binding: 'title', required: true }),
        field('points', {
          type: 'int',
          binding: 'points',
          required: true,
          min: 5,
        }),
        field('level', { type: 'enum', dictionary: d.key }),
        field('goal', { type: 'richtext', binding: 'description' }),
      ];
      const id = await template(fields, { kind: 'creates', target: 'task' });
      const p = await fromTemplate(mod, id);
      const byKey = Object.fromEntries(
        p.template!.fields.map((f) => [f.key, f]),
      );
      expect(byKey.title).toMatchObject({ maxLength: 200 });
      expect(byKey.points).toMatchObject({ min: 5, max: 1000 });
      expect(byKey.level.options!.map((o) => o.key)).toEqual(d.items);
      expect(byKey.goal).toMatchObject({ plain: true, maxLength: 5000 });
    });

    it('учаснику — лише шаблони для всіх; неопублікований чи в архіві — нікому', async () => {
      const staffOnly = await template([], { creators: 'staff' });
      const res = await as(app, member)
        .post('/api/papers')
        .send({ templateId: staffOnly })
        .expect(404);
      expect(res.body.errorCode).toBe('TEMPLATE_NOT_FOUND');
      await fromTemplate(mod, staffOnly);

      const draft = (
        await as(app, mod).post(T).send({ title: 'x', kind: 'free' })
      ).body as { id: string };
      await as(app, mod)
        .post('/api/papers')
        .send({ templateId: draft.id })
        .expect(404);
      await as(app, mod)
        .patch(`${T}/${staffOnly}`)
        .send({ archived: true })
        .expect(200);
      await as(app, admin)
        .post('/api/papers')
        .send({ templateId: staffOnly })
        .expect(404);
    });

    it('вміст разом із шаблоном не приймається', async () => {
      const id = await template([]);
      await as(app, member)
        .post('/api/papers')
        .send({ templateId: id, content: form('x', []) })
        .expect(400);
    });

    it('шаблон, що потребує оновлення, — 409 TEMPLATE_NEEDS_UPDATE', async () => {
      const def = (
        await as(app, mod)
          .post('/api/records/task/field-defs')
          .send({ label: 'Складність', type: 'int' })
          .expect(201)
      ).body as { key: string };
      const id = await template(
        [
          field('title', { binding: 'title', required: true }),
          field('points', { type: 'int', binding: 'points', required: true }),
          field('level', { type: 'int', binding: def.key }),
        ],
        { kind: 'creates', target: 'task' },
      );
      await as(app, mod)
        .patch(`/api/records/task/field-defs/${def.key}`)
        .send({ archived: true })
        .expect(200);
      const res = await as(app, mod)
        .post('/api/papers')
        .send({ templateId: id })
        .expect(409);
      expect(res.body.errorCode).toBe('TEMPLATE_NEEDS_UPDATE');
    });
  });

  describe('значення полів', () => {
    const FIELDS = [
      field('name', { maxLength: 20 }),
      field('count', { type: 'int', min: 1, max: 10 }),
      field('price', { type: 'decimal' }),
      field('day', { type: 'date' }),
      field('due', { type: 'datetime' }),
      field('agree', { type: 'bool' }),
      field('shade', { type: 'color' }),
      field('notes', { type: 'list<text>', maxItems: 2 }),
      field('who', { type: 'ref:user' }),
      field('goal', { type: 'richtext' }),
    ];

    it('зберігаються нормалізованими; чого не передали — спорожнюється', async () => {
      const p = await fromTemplate(member, await template(FIELDS));
      const res = await save(member, p, {
        values: {
          name: '  Іван  ',
          count: 3,
          price: 12.5,
          day: '2026-12-01',
          due: '2026-12-01T12:00:00+02:00',
          agree: false,
          shade: 'teal',
          notes: ['a', 'b'],
        },
      }).expect(200);
      expect((await get(member, p.id)).values).toEqual({
        name: 'Іван',
        count: 3,
        price: 12.5,
        day: '2026-12-01',
        due: '2026-12-01T10:00:00.000Z',
        agree: false,
        shade: 'teal',
        notes: ['a', 'b'],
      });
      await save(
        member,
        { ...p, revision: res.body.revision },
        {
          values: { name: 'Петро', count: null, notes: [] },
        },
      ).expect(200);
      expect((await get(member, p.id)).values).toEqual({ name: 'Петро' });
    });

    it('невірне значення — 400 PAPER_FIELD_INVALID з ключем поля', async () => {
      const p = await fromTemplate(member, await template(FIELDS));
      const bad: [string, unknown][] = [
        ['name', 'x'.repeat(21)],
        ['name', 'два\nрядки'],
        ['count', 11],
        ['count', 1.5],
        ['price', 1.234],
        ['day', '2026-02-30'],
        ['due', 'завтра'],
        ['agree', 'так'],
        ['shade', 'pink'],
        ['notes', ['a', 'b', 'c']],
        // Пікери з'являться згодом; зона пишеться на аркуші, не в значеннях.
        ['who', '00000000-0000-0000-0000-000000000000'],
        ['goal', 'текст'],
        ['ghost', 'x'],
      ];
      for (const [key, value] of bad) {
        const res = await save(member, p, { values: { [key]: value } });
        expect([key, res.status, res.body]).toMatchObject([
          key,
          400,
          { errorCode: 'PAPER_FIELD_INVALID', field: key },
        ]);
      }
      expect((await get(member, p.id)).revision).toBe(p.revision);
    });

    it('вибір: лише чинний пункт; архівний лишається, де вже обраний', async () => {
      const d = await dictionary('Важливість', ['Висока', 'Низька']);
      const fields = [
        field('level', { type: 'enum', dictionary: d.key }),
        field('tags', { type: 'list<enum>', dictionary: d.key }),
      ];
      const p = await fromTemplate(member, await template(fields));
      let rev = (
        await save(member, p, {
          values: { level: d.items[0], tags: [d.items[0]] },
        }).expect(200)
      ).body.revision as number;
      await as(app, mod)
        .patch(`/api/dictionaries/${d.key}/items/${d.items[0]}`)
        .send({ archived: true })
        .expect(200);
      const got = await get(member, p.id);
      expect(got.template!.fields[0].options![0]).toMatchObject({
        key: d.items[0],
        archived: true,
      });
      rev = (
        await save(
          member,
          { ...p, revision: rev },
          {
            values: { level: d.items[0], tags: [d.items[0], d.items[1]] },
          },
        ).expect(200)
      ).body.revision as number;
      const res = await save(
        member,
        { ...p, revision: rev },
        {
          values: { level: 'nope' },
        },
      ).expect(400);
      expect(res.body).toMatchObject({ field: 'level' });

      // Обраний у документі пункт не видаляється.
      const del = await as(app, mod)
        .delete(`/api/dictionaries/${d.key}/items/${d.items[1]}`)
        .expect(409);
      expect(del.body.errorCode).toBe('DICTIONARY_ITEM_IN_USE');
    });

    it('вільний документ значень не має', async () => {
      const p = (await as(app, member).post('/api/papers').send({}).expect(201))
        .body as Paper;
      expect(p).toMatchObject({ values: {}, template: null });
      const res = await save(member, p, { values: { a: 1 } }).expect(400);
      expect(res.body).toMatchObject({
        errorCode: 'PAPER_FIELD_INVALID',
        field: 'a',
      });
      await save(member, p, { values: {} }).expect(200);
    });
  });

  describe('поле «заповнює модератор»', () => {
    const FIELDS = [
      field('name'),
      field('verdict', { fill: 'staff' }),
      field('review', { type: 'richtext', fill: 'staff' }),
    ];

    it('учасник його не заповнює (і зону теж) — 403; модератор у своєму — так', async () => {
      const id = await template(FIELDS);
      const p = await fromTemplate(member, id);
      expect(p.template!.fields.map((f) => f.canFill)).toEqual([
        true,
        false,
        false,
      ]);
      for (const body of [
        { values: { verdict: 'так' } },
        { content: withZone(p.content, 'review', [para('добре')]) },
      ]) {
        const res = await save(member, p, body).expect(403);
        expect(res.body.errorCode).toBe('NOT_ALLOWED');
      }
      await save(member, p, { values: { name: 'Іван' } }).expect(200);

      const own = await fromTemplate(mod, id);
      expect(own.template!.fields.every((f) => f.canFill)).toBe(true);
      await save(mod, own, {
        values: { verdict: 'так' },
        content: withZone(own.content, 'review', [para('добре')]),
      }).expect(200);
    });
  });

  describe('заблокований текст', () => {
    const FIELDS = [
      field('name'),
      field('goal', { type: 'richtext', maxLength: 10 }),
    ];

    it('у зоні — будь-який текст; поза зонами — 400 PAPER_CONTENT_LOCKED', async () => {
      const p = await fromTemplate(member, await template(FIELDS));
      const filled = withZone(p.content, 'goal', [
        para('Мета', [{ type: 'bold' }]),
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [para('a')] }],
        },
      ]);
      await save(member, p, { content: filled }).expect(200);
      expect((await get(member, p.id)).content).toEqual(filled);

      const changed = structuredClone(filled);
      changed.content![0] = para('Інша заява');
      const removedField = structuredClone(filled);
      removedField.content![1].content!.pop();
      const nested = withZone(filled, 'goal', [
        {
          type: 'paragraph',
          content: [{ type: 'field', attrs: { key: 'name' } }],
        },
      ]);
      for (const content of [changed, removedField, nested]) {
        const res = await save(
          member,
          { ...p, revision: p.revision + 1 },
          {
            content,
          },
        ).expect(400);
        expect(res.body.errorCode).toBe('PAPER_CONTENT_LOCKED');
      }
    });

    it('атрибути за замовчуванням і порядок позначок не важать', async () => {
      const p = await fromTemplate(member, await template(FIELDS));
      const explicit = structuredClone(p.content);
      explicit.content![0].attrs = { align: null, indent: 0 };
      await save(member, p, { content: explicit }).expect(200);
    });

    it('зона довша за межу — PAPER_FIELD_INVALID', async () => {
      const p = await fromTemplate(member, await template(FIELDS));
      const res = await save(member, p, {
        content: withZone(p.content, 'goal', [para('x'.repeat(11))]),
      }).expect(400);
      expect(res.body).toMatchObject({
        errorCode: 'PAPER_FIELD_INVALID',
        field: 'goal',
      });
    });

    it('зона, прив’язана до текстового поля запису, — лише прості абзаци', async () => {
      const fields = [
        field('title', { binding: 'title', required: true }),
        field('points', { type: 'int', binding: 'points', required: true }),
        field('goal', { type: 'richtext', binding: 'description' }),
      ];
      const p = await fromTemplate(
        mod,
        await template(fields, { kind: 'creates', target: 'task' }),
      );
      for (const zone of [
        [para('а', [{ type: 'italic' }])],
        [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'а' }],
          },
        ],
      ]) {
        const res = await save(mod, p, {
          content: withZone(p.content, 'goal', zone),
        }).expect(400);
        expect(res.body.errorCode).toBe('PAPER_CONTENT_LOCKED');
      }
      await save(mod, p, {
        content: withZone(p.content, 'goal', [para('рядок'), para('другий')]),
      }).expect(200);
    });

    it('у вільному документі полів немає', async () => {
      const p = (await as(app, member).post('/api/papers').send({}).expect(201))
        .body as Paper;
      const res = await save(member, p, {
        content: form('x', [field('name')]),
      }).expect(400);
      expect(res.body.errorCode).toBe('PAPER_CONTENT_LOCKED');
    });
  });

  describe('друк', () => {
    it('значення замість полів; порожнє — лінія; «не друкувати» — немає', async () => {
      const d = await dictionary('Важливість', ['Висока']);
      const fields = [
        field('name'),
        field('day', { type: 'date' }),
        field('level', { type: 'enum', dictionary: d.key }),
        field('empty'),
        field('secret', { print: false }),
        field('goal', { type: 'richtext' }),
      ];
      const p = await fromTemplate(member, await template(fields));
      await save(member, p, {
        values: {
          name: 'Іван <b>',
          day: '2026-12-01',
          level: d.items[0],
          secret: 'таємниця',
        },
        content: withZone(p.content, 'goal', [para('Мета роботи')]),
      }).expect(200);
      const html = (
        await as(app, member).get(`/api/papers/${p.id}/print`).expect(200)
      ).text;
      expect(html).toContain(
        'name: <span class="paper-field">Іван &lt;b&gt;</span>',
      );
      expect(html).toContain('<span class="paper-field">01.12.2026</span>');
      expect(html).toContain('<span class="paper-field">Висока</span>');
      expect(html).toContain('empty: <span class="paper-field-blank"></span>');
      expect(html).not.toContain('таємниця');
      expect(html).toContain('<p>secret: </p>');
      expect(html).toContain(
        '<div class="paper-zone" data-field="goal"><p>Мета роботи</p></div>',
      );
    });
  });

  describe('копія', () => {
    it('та сама версія шаблону, навіть коли є новіша; значення перевіряються', async () => {
      const fields = [field('name'), field('goal', { type: 'richtext' })];
      const id = await template(fields);
      const p = await fromTemplate(member, id);
      // Нова версія шаблону з іншим тілом.
      await as(app, mod).post(`${T}/${id}/versions`).expect(201);
      await as(app, mod)
        .patch(`${T}/${id}/versions/2`)
        .send({ revision: 1, body: form('Заява v2', fields) })
        .expect(200);
      await as(app, mod).post(`${T}/${id}/versions/2/publish`).expect(201);

      const content = withZone(p.content, 'goal', [para('моя мета')]);
      const bad = await as(app, member)
        .post(`/api/papers/${p.id}/copy`)
        .send({ content, values: { name: 5 } })
        .expect(400);
      expect(bad.body).toMatchObject({ field: 'name' });
      const copy = (
        await as(app, member)
          .post(`/api/papers/${p.id}/copy`)
          .send({ title: 'Заява (копія)', content, values: { name: 'Іван' } })
          .expect(201)
      ).body as Paper;
      expect(copy).toMatchObject({
        title: 'Заява (копія)',
        values: { name: 'Іван' },
        content,
        template: { id, version: 1 },
      });
      const [log] = await app
        .get(DataSource)
        .getRepository(AuditLog)
        .findBy({ action: 'paper.created', entityId: copy.id });
      expect(log.meta).toMatchObject({ copyOf: p.id, version: 1 });
    });

    it('вільний документ копіюється з переданим вмістом', async () => {
      const p = (await as(app, member).post('/api/papers').send({}).expect(201))
        .body as Paper;
      const copy = (
        await as(app, member)
          .post(`/api/papers/${p.id}/copy`)
          .send({ content: form('мій текст', []) })
          .expect(201)
      ).body as Paper;
      expect(copy).toMatchObject({
        title: 'Без назви',
        template: null,
        content: form('мій текст', []),
      });
    });

    it('чужий невидимий — 404; з шаблону лише для модераторів учасник не копіює', async () => {
      const own = (await as(app, mod).post('/api/papers').send({}).expect(201))
        .body as Paper;
      await as(app, member)
        .post(`/api/papers/${own.id}/copy`)
        .send({ content: form('x', []) })
        .expect(404);

      const p = await fromTemplate(
        mod,
        await template([], { creators: 'staff' }),
      );
      await app
        .get(DataSource)
        .query(
          `UPDATE papers SET status = 'published', visibility = 'members' WHERE id = $1`,
          [p.id],
        );
      await as(app, member)
        .post(`/api/papers/${p.id}/copy`)
        .send({ content: p.content })
        .expect(404);
    });
  });
});
