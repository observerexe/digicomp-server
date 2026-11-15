import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { RecordLink } from '../src/links/record-link.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeTask,
  makeUser,
  resetDb,
  TestUser,
} from './helpers';

// Посилання документа на записи (2.2б): поля `ref:*`, «@» у тексті, зв'язки
// документа в record_links, назви записів у відповіді й друці.

type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Paper = {
  id: string;
  revision: number;
  content: Node;
  values: Record<string, unknown>;
  template: { fields: { key: string; canFill: boolean }[] } | null;
  refs: { type: string; id: string; title: string; archived: boolean }[];
};
type Link = {
  type: string;
  recordId: string;
  direction: string;
  role: string;
  canRemove: boolean;
};

const MISSING = '00000000-0000-4000-8000-000000000000';

const field = (key: string, type: string) => ({
  key,
  label: key,
  type,
  required: false,
  fill: 'author',
  editable: false,
  print: true,
});
const line = (key: string): Node => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: `${key}: ` },
    { type: 'field', attrs: { key } },
  ],
});
const mention = (type: string, id: string): Node => ({
  type: 'mention',
  attrs: { type, id },
});
const docOf = (...inline: Node[]): Node => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: inline }],
});

describe('Посилання документа на записи (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let other: TestUser;
  let taskId: string;
  let projectId: string;
  let hiddenDocId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    other = await makeUser(app, Role.Member);
    await category(app, 'document_category', 'Паспорти');
    taskId = (await makeTask(app, mod, { title: 'Корпус', points: 5 })).id;
    projectId = (
      await as(app, mod)
        .post('/api/projects')
        .send({ title: 'Робот', memberIds: [member.id] })
        .expect(201)
    ).body.id;
    hiddenDocId = (
      await as(app, mod)
        .post('/api/documents')
        .field('title', 'Для модераторів')
        .field('category', 'pasporty')
        .field('accessScope', 'supervisors')
        .attach('file', Buffer.from('текст'), 'a.txt')
        .expect(201)
    ).body.id;
  });

  const T = '/api/papers/templates';
  const FIELDS = [
    field('task', 'ref:task'),
    field('also', 'ref:task'),
    field('team', 'list<ref:user>'),
    field('file', 'ref:document'),
  ];
  const template = async (fields = FIELDS) => {
    const t = (
      await as(app, mod)
        .post(T)
        .send({ title: 'Заява', kind: 'free', creators: 'all' })
        .expect(201)
    ).body as { id: string };
    await as(app, mod)
      .patch(`${T}/${t.id}/versions/1`)
      .send({
        revision: 1,
        fields,
        body: { type: 'doc', content: fields.map((f) => line(f.key)) },
      })
      .expect(200);
    return t.id;
  };
  const publish = (id: string) =>
    as(app, mod).post(`${T}/${id}/versions/1/publish`);
  const fromTemplate = async (u: TestUser) => {
    const id = await template();
    await publish(id).expect(201);
    return (
      await as(app, u).post('/api/papers').send({ templateId: id }).expect(201)
    ).body as Paper;
  };
  const free = async (u: TestUser) =>
    (await as(app, u).post('/api/papers').send({}).expect(201)).body as Paper;
  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  /** Saves and returns the document as it is now. */
  const save = async (u: TestUser, p: Paper, body: object, status = 200) => {
    const now = await get(u, p.id);
    return as(app, u)
      .patch(`/api/papers/${p.id}`)
      .send({ revision: now.revision, ...body })
      .expect(status);
  };
  const paperLinks = async () =>
    (await ds.getRepository(RecordLink).findBy({ fromType: 'paper' }))
      .map((l) => `${l.toType}:${l.toId}:${l.role}`)
      .sort();
  const linksOf = async (u: TestUser, type: string, id: string) =>
    (await as(app, u).get('/api/links').query({ type, id }).expect(200)).body
      .items as Link[];

  describe('поля ref:*', () => {
    it('заповнюються; вибір пише зв’язок з роллю поля, очищення — прибирає', async () => {
      const p = await fromTemplate(member);
      expect(p.template!.fields.every((f) => f.canFill)).toBe(true);
      await save(member, p, {
        values: { task: taskId, team: [member.id, other.id] },
      });
      expect(await paperLinks()).toEqual(
        [
          `task:${taskId}:task`,
          `user:${member.id}:team`,
          `user:${other.id}:team`,
        ].sort(),
      );
      const now = await get(member, p.id);
      expect(now.refs).toEqual(
        expect.arrayContaining([
          { type: 'task', id: taskId, title: 'Корпус', archived: false },
          {
            type: 'user',
            id: other.id,
            title: other.name,
            archived: false,
          },
        ]),
      );

      // Той самий запис в іншому полі — зв'язок з новою роллю.
      await save(member, p, { values: { also: taskId } });
      expect(await paperLinks()).toEqual([`task:${taskId}:also`]);
      await save(member, p, { values: {} });
      expect(await paperLinks()).toEqual([]);
    });

    it('запис, якого немає або якого людина не бачить, — 400 PAPER_FIELD_INVALID з ключем', async () => {
      const p = await fromTemplate(member);
      for (const [key, value] of [
        ['task', MISSING],
        ['file', hiddenDocId],
        ['team', [member.id, member.id]],
      ] as const) {
        const res = await save(member, p, { values: { [key]: value } }, 400);
        expect(res.body).toMatchObject({
          errorCode: 'PAPER_FIELD_INVALID',
          field: key,
        });
      }
      // Модератор той самий документ бачить.
      const mine = await fromTemplate(mod);
      await save(mod, mine, { values: { file: hiddenDocId } });
    });

    it('видалений запис лишається в документі: зберігається, у друці — «запис недоступний»', async () => {
      const p = await fromTemplate(member);
      await save(member, p, { values: { task: taskId, also: taskId } });
      await as(app, mod)
        .post(`/api/tasks/${taskId}/cancel`)
        .send({ reason: 'Не потрібно' })
        .expect(200);
      expect(await paperLinks()).toEqual([]);
      await save(member, p, { values: { task: taskId } });
      // Зв'язок на видалений запис не повертається.
      expect(await paperLinks()).toEqual([]);
      expect((await get(member, p.id)).refs).toEqual([]);
      const html = (
        await as(app, member).get(`/api/papers/${p.id}/print`).expect(200)
      ).text;
      expect(html).toContain(
        'task: <span class="paper-field">запис недоступний</span>',
      );
    });

    it('шаблон з посиланням на тип без пікера не публікується', async () => {
      const id = await template([field('s', 'ref:session')]);
      const res = await publish(id).expect(400);
      expect(res.body).toMatchObject({
        errorCode: 'TEMPLATE_FIELD_INVALID',
        field: 's',
      });
    });
  });

  describe('«@» у тексті', () => {
    it('посилання пише зв’язок без ролі; прибране — прибирає', async () => {
      const p = await free(member);
      await save(member, p, {
        content: docOf(
          mention('task', taskId),
          { type: 'text', text: ' і ' },
          mention('project', projectId),
          mention('task', taskId),
        ),
      });
      expect(await paperLinks()).toEqual(
        [`project:${projectId}:`, `task:${taskId}:`].sort(),
      );
      expect((await get(member, p.id)).refs).toHaveLength(2);
      await save(member, p, { content: docOf(mention('task', taskId)) });
      expect(await paperLinks()).toEqual([`task:${taskId}:`]);
    });

    it('на запис, якого немає чи не видно, — 404 RECORD_NOT_FOUND', async () => {
      const p = await free(member);
      for (const content of [
        docOf(mention('task', MISSING)),
        docOf(mention('document', hiddenDocId)),
        docOf(mention('session', taskId)),
      ]) {
        const res = await save(member, p, { content }, 404);
        expect(res.body.errorCode).toBe('RECORD_NOT_FOUND');
      }
    });

    it('вже пов’язана навпаки пара не заважає', async () => {
      const p = await free(mod);
      await as(app, mod)
        .post('/api/links')
        .send({ fromType: 'task', fromId: taskId, toType: 'paper', toId: p.id })
        .expect(201);
      await save(mod, p, { content: docOf(mention('task', taskId)) });
      await save(mod, p, { content: docOf({ type: 'text', text: 'а' }) });
      // Зв'язок від ТЗ — не документа: лишається.
      expect(await linksOf(mod, 'task', taskId)).toHaveLength(1);
    });

    it('друк: назва запису', async () => {
      const p = await free(member);
      await save(member, p, { content: docOf(mention('project', projectId)) });
      const html = (
        await as(app, member).get(`/api/papers/${p.id}/print`).expect(200)
      ).text;
      expect(html).toContain('<span class="paper-ref">Робот</span>');
    });

    it('новий документ зі вмістом перевіряється так само', async () => {
      const res = await as(app, member)
        .post('/api/papers')
        .send({ content: docOf(mention('document', hiddenDocId)) })
        .expect(404);
      expect(res.body.errorCode).toBe('RECORD_NOT_FOUND');
      await as(app, member)
        .post('/api/papers')
        .send({ content: docOf(mention('task', taskId)) })
        .expect(201);
      expect(await paperLinks()).toEqual([`task:${taskId}:`]);
    });
  });

  describe('зв’язки документа', () => {
    it('видно на сторінці запису тим, хто бачить документ; вручну не змінюються', async () => {
      const p = await free(member);
      await save(member, p, { content: docOf(mention('task', taskId)) });
      const [l] = await linksOf(mod, 'task', taskId);
      expect(l).toMatchObject({
        type: 'paper',
        recordId: p.id,
        direction: 'in',
        canRemove: false,
      });
      // Чужу чернетку учасник не бачить.
      expect(await linksOf(other, 'task', taskId)).toEqual([]);
      expect(await linksOf(member, 'task', taskId)).toHaveLength(1);
      await as(app, admin)
        .post('/api/links')
        .send({
          fromType: 'paper',
          fromId: p.id,
          toType: 'project',
          toId: projectId,
        })
        .expect(403);
    });

    it('видалена чернетка забирає свої зв’язки', async () => {
      const p = await free(member);
      await save(member, p, { content: docOf(mention('task', taskId)) });
      await as(app, member).delete(`/api/papers/${p.id}`).expect(200);
      expect(await paperLinks()).toEqual([]);
    });

    it('копія: записи оригіналу приймаються; пов’язуються ті, що є й видимі', async () => {
      const p = await free(member);
      await save(member, p, {
        content: docOf(mention('task', taskId), mention('project', projectId)),
      });
      await as(app, mod)
        .post(`/api/tasks/${taskId}/cancel`)
        .send({ reason: 'Не потрібно' })
        .expect(200);
      const content = docOf(
        mention('task', taskId),
        mention('project', projectId),
      );
      // Нове посилання в копії перевіряється, як у збереженні.
      const bad = await as(app, member)
        .post(`/api/papers/${p.id}/copy`)
        .send({
          content: docOf(
            mention('project', projectId),
            mention('document', hiddenDocId),
          ),
        })
        .expect(404);
      expect(bad.body.errorCode).toBe('RECORD_NOT_FOUND');
      const copy = (
        await as(app, member)
          .post(`/api/papers/${p.id}/copy`)
          .send({ content })
          .expect(201)
      ).body as Paper;
      const links = await ds
        .getRepository(RecordLink)
        .findBy({ fromType: 'paper', fromId: copy.id });
      expect(links.map((l) => `${l.toType}:${l.toId}`)).toEqual([
        `project:${projectId}`,
      ]);
      expect(copy.refs).toEqual([
        { type: 'project', id: projectId, title: 'Робот', archived: false },
      ]);
    });

    it('учасники: пошук — лише активні; заблокованого бачить лише модератор', async () => {
      const found = (
        await as(app, member)
          .get('/api/links/candidates')
          .query({ type: 'user', q: other.name })
          .expect(200)
      ).body as { id: string }[];
      expect(found.map((u) => u.id)).toEqual([other.id]);
      const p = await fromTemplate(mod);
      await save(mod, p, { values: { team: [other.id] } });
      await as(app, admin)
        .patch(`/api/users/${other.id}`)
        .send({ active: false })
        .expect(200);
      expect(
        (
          await as(app, member)
            .get('/api/links/candidates')
            .query({ type: 'user', q: other.name })
            .expect(200)
        ).body,
      ).toEqual([]);
      expect((await get(mod, p.id)).refs).toEqual([
        { type: 'user', id: other.id, title: other.name, archived: true },
      ]);
    });
  });
});
