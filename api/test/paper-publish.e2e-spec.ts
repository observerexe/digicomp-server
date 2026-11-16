import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeTask,
  makeUser,
  resetDb,
  TestUser,
  withTasks,
} from './helpers';

// Публікація й скасування документів (3.1а): обов'язкові поля, номери,
// документ, що створює ТЗ (адаптер), видимість через запис, поточні дані
// запису в прив'язаних полях, скасування ↔ зняття ТЗ, TASK_HAS_PAPER.

type Field = Record<string, unknown> & { key: string; type: string };
type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Paper = {
  id: string;
  title: string;
  number: string | null;
  status: string;
  revision: number;
  publishedAt: string | null;
  content: Node;
  values: Record<string, unknown>;
  targetType: string | null;
  targetId: string | null;
  cancelReason: string | null;
  canEdit: boolean;
  canPublish: boolean;
  canCancel: boolean;
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

/** A line «label: [field]» a field, a zone for `richtext`, and the number. */
const form = (fields: Field[]): Node => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '№ ' }, { type: 'paperNumber' }],
    },
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

const withZone = (doc: Node, key: string, text: string): Node => ({
  ...doc,
  content: doc.content!.map((n) =>
    n.type === 'fieldZone' && n.attrs?.key === key
      ? {
          ...n,
          content: text
            .split('\n')
            .map((l) =>
              l
                ? { type: 'paragraph', content: [{ type: 'text', text: l }] }
                : { type: 'paragraph' },
            ),
        }
      : n,
  ),
});

const zoneText = (doc: Node, key: string) =>
  doc
    .content!.find((n) => n.type === 'fieldZone' && n.attrs?.key === key)!
    .content!.map((p) => (p.content ?? []).map((t) => t.text).join(''))
    .join('\n');

/** Fields of «Технічне завдання»: everything a task needs, bound. */
const TASK_FIELDS: Field[] = [
  field('name', { label: 'Назва', binding: 'title', required: true }),
  field('goal', { label: 'Мета', type: 'richtext', binding: 'description' }),
  field('points', {
    label: 'Бали',
    type: 'int',
    binding: 'points',
    required: true,
  }),
  field('due', { label: 'Термін', type: 'datetime', binding: 'dueDate' }),
  field('note', { label: 'Примітка' }),
];

const YEAR = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
}).format(new Date());

describe('Публікація документів (e2e)', () => {
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
  const template = async (
    fields: Field[],
    over: Record<string, unknown> = {},
  ) => {
    const t = (
      await as(app, mod)
        .post(T)
        .send({ title: 'Заява', kind: 'free', creators: 'all', ...over })
        .expect(201)
    ).body as { id: string };
    await as(app, mod)
      .patch(`${T}/${t.id}/versions/1`)
      .send({ revision: 1, fields, body: form(fields) })
      .expect(200);
    await as(app, mod).post(`${T}/${t.id}/versions/1/publish`).expect(201);
    return t.id;
  };
  const taskTemplate = () =>
    template(TASK_FIELDS, {
      title: 'Технічне завдання',
      kind: 'creates',
      target: 'task',
      numberPrefix: 'ТЗ',
      creators: 'staff',
    });
  const fromTemplate = async (u: TestUser, templateId: string) =>
    (await as(app, u).post('/api/papers').send({ templateId }).expect(201))
      .body as Paper;
  const fill = async (
    u: TestUser,
    p: Paper,
    values: Record<string, unknown>,
    content?: Node,
  ) =>
    (
      await as(app, u)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, values, content })
        .expect(200)
    ).body as { revision: number };
  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const publish = (u: TestUser, id: string) =>
    as(app, u).post(`/api/papers/${id}/publish`);
  const cancel = (u: TestUser, id: string, reason = 'Не потрібно') =>
    as(app, u).post(`/api/papers/${id}/cancel`).send({ reason });
  const audit = (action: string) =>
    app.get(DataSource).getRepository(AuditLog).findBy({ action });

  /** A filled «Технічне завдання» of the moderator. */
  const taskPaper = async (by: TestUser = mod) => {
    const p = await fromTemplate(by, await taskTemplate());
    await fill(
      by,
      p,
      {
        name: 'Логотип',
        points: 30,
        due: '2026-12-01T10:00:00.000Z',
        note: 'терміново',
      },
      withZone(p.content, 'goal', 'Новий логотип\nу двох кольорах'),
    );
    return get(by, p.id);
  };

  describe('вільний документ', () => {
    it('автор публікує: стан, дата, аудит; без префікса — без номера', async () => {
      const p = (await as(app, member).post('/api/papers').send({}).expect(201))
        .body as Paper;
      expect(p.canPublish).toBe(true);
      const res = await publish(member, p.id).expect(200);
      const done = res.body as Paper;
      expect(done).toMatchObject({
        status: 'published',
        number: null,
        canEdit: false,
        canPublish: false,
        canCancel: true,
      });
      expect(done.publishedAt).not.toBeNull();
      expect(done.revision).toBe(p.revision + 1);
      expect(await audit('paper.published')).toHaveLength(1);

      const again = await publish(member, p.id).expect(409);
      expect(again.body.errorCode).toBe('PAPER_NOT_DRAFT');
      const edit = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: done.revision, title: 'Інше' })
        .expect(409);
      expect(edit.body.errorCode).toBe('PAPER_NOT_DRAFT');
    });

    it('номер за префіксом шаблону: рік і порядковий, без повторів навіть разом', async () => {
      const id = await template([field('name')], { numberPrefix: 'ПЗ' });
      const papers = await Promise.all(
        [1, 2, 3].map(() => fromTemplate(member, id)),
      );
      const numbers = (
        await Promise.all(papers.map((p) => publish(member, p.id).expect(200)))
      ).map((r) => (r.body as Paper).number!);
      expect(numbers.sort((a, b) => a.localeCompare(b))).toEqual([
        `ПЗ-${YEAR}-001`,
        `ПЗ-${YEAR}-002`,
        `ПЗ-${YEAR}-003`,
      ]);
      // Пошук знаходить за номером.
      const list = await as(app, member)
        .get(`/api/papers?search=ПЗ-${YEAR}-002`)
        .expect(200);
      expect(list.body.items).toHaveLength(1);
    });

    it('друк показує номер на місці «Авто: номер»; у чернетці — лінія', async () => {
      const id = await template([field('name')], { numberPrefix: 'ПЗ' });
      const p = await fromTemplate(member, id);
      const draft = await as(app, member)
        .get(`/api/papers/${p.id}/print`)
        .expect(200);
      expect(draft.text).toContain('№ <span class="paper-field-blank">');
      await publish(member, p.id).expect(200);
      const printed = await as(app, member)
        .get(`/api/papers/${p.id}/print`)
        .expect(200);
      expect(printed.text).toContain(
        `№ <span class="paper-field">ПЗ-${YEAR}-001</span>`,
      );
    });

    it('обов’язкове поле чи зона порожні — 400 PAPER_REQUIRED_MISSING з ключем', async () => {
      const fields = [
        field('name', { required: true }),
        field('body', { type: 'richtext', required: true }),
      ];
      const p = await fromTemplate(member, await template(fields));
      const r1 = await publish(member, p.id).expect(400);
      expect(r1.body).toMatchObject({
        errorCode: 'PAPER_REQUIRED_MISSING',
        field: 'name',
      });
      const { revision } = await fill(member, p, { name: 'Іван' });
      const r2 = await publish(member, p.id).expect(400);
      expect(r2.body).toMatchObject({
        errorCode: 'PAPER_REQUIRED_MISSING',
        field: 'body',
      });
      await fill(
        member,
        { ...p, revision },
        { name: 'Іван' },
        withZone(p.content, 'body', 'Текст'),
      );
      await publish(member, p.id).expect(200);
    });

    it('чужу чернетку: учасник — не бачить (404); модератор публікує', async () => {
      const p = (await as(app, member).post('/api/papers').send({}))
        .body as Paper;
      const other = await makeUser(app, Role.Member);
      await publish(other, p.id).expect(404);
      await publish(mod, p.id).expect(200);
    });

    it('скасування: з причиною; чернетку чи скасований — 409 PAPER_NOT_PUBLISHED', async () => {
      const p = (await as(app, member).post('/api/papers').send({}))
        .body as Paper;
      const draft = await cancel(member, p.id).expect(409);
      expect(draft.body.errorCode).toBe('PAPER_NOT_PUBLISHED');
      await publish(member, p.id).expect(200);
      await cancel(member, p.id, '  ').expect(400);
      const res = await cancel(member, p.id, ' Помилка ').expect(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Помилка',
        canCancel: false,
      });
      const [log] = await audit('paper.cancelled');
      expect(log.meta).toMatchObject({ reason: 'Помилка' });
      const again = await cancel(member, p.id).expect(409);
      expect(again.body.errorCode).toBe('PAPER_NOT_PUBLISHED');
    });

    it('чужий опублікований для всіх: учасник не скасовує (403), модератор — так', async () => {
      const p = (await as(app, mod).post('/api/papers').send({})).body as Paper;
      await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, visibility: 'members' })
        .expect(200);
      await publish(mod, p.id).expect(200);
      expect((await get(member, p.id)).canCancel).toBe(false);
      const res = await cancel(member, p.id).expect(403);
      expect(res.body.errorCode).toBe('NOT_OWNER');
      await cancel(admin, p.id).expect(200);
    });
  });

  describe('документ, що створює ТЗ', () => {
    it('публікація створює ТЗ з прив’язаних полів, видає номер і пов’язує документ', async () => {
      const p = await taskPaper();
      const res = await publish(mod, p.id).expect(200);
      const done = res.body as Paper;
      expect(done).toMatchObject({
        status: 'published',
        number: `ТЗ-${YEAR}-001`,
        targetType: 'task',
      });
      const task = (
        await as(app, member).get(`/api/tasks/${done.targetId}`).expect(200)
      ).body as Record<string, unknown>;
      expect(task).toMatchObject({
        title: 'Логотип',
        description: 'Новий логотип\nу двох кольорах',
        points: 30,
        status: 'todo',
        createdById: mod.id,
      });
      expect(new Date(task.dueDate as string).toISOString()).toBe(
        '2026-12-01T10:00:00.000Z',
      );
      const [created] = await audit('task.created');
      expect(created.entityId).toBe(done.targetId);
      expect((await audit('paper.published'))[0].meta).toMatchObject({
        number: `ТЗ-${YEAR}-001`,
        targetType: 'task',
        targetId: done.targetId,
      });
      // На сторінці ТЗ документ — у «Пов’язаному».
      const links = await as(app, member)
        .get(`/api/links?type=task&id=${done.targetId}`)
        .expect(200);
      expect(links.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'paper', recordId: p.id }),
        ]),
      );
    });

    it('учасник бачить документ ТЗ (через запис) і в списку, але не чернетку', async () => {
      const p = await taskPaper();
      await as(app, member).get(`/api/papers/${p.id}`).expect(404);
      await publish(mod, p.id).expect(200);
      expect((await get(member, p.id)).values).toMatchObject({
        name: 'Логотип',
      });
      const list = await as(app, member).get('/api/papers').expect(200);
      expect(list.body.items.map((x: Paper) => x.id)).toEqual([p.id]);
    });

    it('прив’язані поля показують ТЗ як воно є зараз; неприв’язані — як записали', async () => {
      const p = await taskPaper();
      const { targetId } = (await publish(mod, p.id).expect(200)).body as Paper;
      // ТЗ змінили не через цей документ (як змінив би інший шлях до сервісу).
      const changed = await withTasks(app, (tasks, m) =>
        tasks.update(
          targetId!,
          { title: 'Логотип 2', description: 'Інша мета', dueDate: null },
          mod,
          m,
        ),
      );
      expect(changed.status).toBe(200);
      const now = await get(member, p.id);
      expect(now.values).toEqual({
        name: 'Логотип 2',
        points: 30,
        note: 'терміново',
      });
      expect(zoneText(now.content, 'goal')).toBe('Інша мета');
      const printed = await as(app, member)
        .get(`/api/papers/${p.id}/print`)
        .expect(200);
      expect(printed.text).toContain('Логотип 2');
      expect(printed.text).toContain('Інша мета');
    });

    it('учасник не публікує документ, що створює ТЗ (право на ТЗ) — 403', async () => {
      const id = await template(TASK_FIELDS, {
        kind: 'creates',
        target: 'task',
        creators: 'all',
      });
      const p = await fromTemplate(member, id);
      await fill(
        member,
        p,
        { name: 'Логотип', points: 5 },
        withZone(p.content, 'goal', 'Мета'),
      );
      await publish(member, p.id).expect(403);
      expect((await get(member, p.id)).status).toBe('draft');
      expect(
        (await as(app, mod).get('/api/tasks').expect(200)).body,
      ).toHaveLength(0);
    });

    it('помилка ТЗ про поле повертається з ключем поля шаблону', async () => {
      const dict = (
        await as(app, mod)
          .post('/api/dictionaries')
          .send({ title: 'Тип ТЗ' })
          .expect(201)
      ).body as { key: string };
      const item = (
        await as(app, mod)
          .post(`/api/dictionaries/${dict.key}/items`)
          .send({ title: 'Дизайн' })
          .expect(201)
      ).body as { key: string };
      const def = (
        await as(app, mod)
          .post('/api/records/task/field-defs')
          .send({ label: 'Тип', type: 'enum', dictionary: dict.key })
          .expect(201)
      ).body as { key: string };
      const fields = [
        ...TASK_FIELDS,
        field('kind', { type: 'enum', binding: def.key }),
      ];
      const id = await template(fields, { kind: 'creates', target: 'task' });
      const p = await fromTemplate(mod, id);
      await fill(mod, p, { name: 'Логотип', points: 5, kind: item.key });
      // Пункт довідника пішов в архів: у документі лишається, у нове ТЗ — ні.
      await as(app, mod)
        .patch(`/api/dictionaries/${dict.key}/items/${item.key}`)
        .send({ archived: true })
        .expect(200);
      const res = await publish(mod, p.id).expect(400);
      expect(res.body).toMatchObject({
        errorCode: 'RECORD_EXTRA_INVALID',
        field: 'kind',
      });
      expect((await get(mod, p.id)).status).toBe('draft');
    });

    it('ТЗ з документом не скасовується без нього — 409 TASK_HAS_PAPER; ТЗ знає свій документ', async () => {
      const p = await taskPaper();
      const done = (await publish(mod, p.id).expect(200)).body as Paper;
      const res = await as(app, mod)
        .post(`/api/tasks/${done.targetId}/cancel`)
        .send({ reason: 'Не потрібно' });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('TASK_HAS_PAPER');
      const paper = { id: p.id, number: `ТЗ-${YEAR}-001` };
      const one = await as(app, member)
        .get(`/api/tasks/${done.targetId}`)
        .expect(200);
      expect(one.body.paper).toEqual(paper);
      const board = await as(app, member).get('/api/tasks').expect(200);
      expect(board.body[0].paper).toEqual(paper);
      const taken = await as(app, member)
        .post(`/api/tasks/${done.targetId}/take`)
        .expect(200);
      expect(taken.body.paper).toEqual(paper);
    });

    it('скасування документа знімає вільне ТЗ; учасник не скасовує', async () => {
      const p = await taskPaper();
      const { targetId } = (await publish(mod, p.id).expect(200)).body as Paper;
      await cancel(member, p.id).expect(403);
      const res = await cancel(mod, p.id, 'Замовник відмовився').expect(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Замовник відмовився',
        targetId,
        // ТЗ немає — лишаються записані значення.
        values: { name: 'Логотип', points: 30 },
      });
      await as(app, mod).get(`/api/tasks/${targetId}`).expect(404);
      const [deleted] = await audit('task.deleted');
      expect(deleted.meta).toMatchObject({ reason: 'Замовник відмовився' });
      // Скасований документ ТЗ учасник далі бачить.
      expect((await get(member, p.id)).status).toBe('cancelled');
    });

    it('після того як ТЗ взяли, скасувати не можна — 409 TASK_HAS_ASSIGNEES', async () => {
      const p = await taskPaper();
      const { targetId } = (await publish(mod, p.id).expect(200)).body as Paper;
      await as(app, member).post(`/api/tasks/${targetId}/take`).expect(200);
      const res = await cancel(admin, p.id).expect(409);
      expect(res.body.errorCode).toBe('TASK_HAS_ASSIGNEES');
      expect((await get(mod, p.id)).status).toBe('published');
    });
  });

  describe('шаблони', () => {
    it('«створює запис» — лише для типів з адаптером; їх список — модераторам', async () => {
      const targets = await as(app, mod).get(`${T}/targets`).expect(200);
      // Sources of auto tables — paper-tables.e2e-spec.ts.
      expect(targets.body).toMatchObject({
        creates: ['discipline_record', 'points_entry', 'task'],
        report: ['discipline_record', 'fault', 'place', 'points_entry', 'task'],
      });
      await as(app, member).get(`${T}/targets`).expect(403);
      const res = await as(app, mod)
        .post(T)
        .send({ title: 'Проєкт', kind: 'creates', target: 'project' })
        .expect(400);
      expect(res.body.errorCode).toBe('TEMPLATE_KIND_INVALID');
    });
  });

  describe('ТЗ: здано й прийнято', () => {
    it('здача пише час, прийняття — хто прийняв', async () => {
      const t = await makeTask(app, mod, { title: 'Афіша', points: 10 });
      const url = `/api/tasks/${t.id}`;
      await as(app, member).post(`${url}/take`).expect(200);
      await as(app, member).post(`${url}/start`).expect(200);
      const submitted = (
        await as(app, member).post(`${url}/submit`).expect(200)
      ).body as Record<string, unknown>;
      expect(submitted.submittedAt).not.toBeNull();
      expect(submitted.acceptedById).toBeNull();
      const accepted = (await as(app, mod).post(`${url}/accept`).expect(200))
        .body as Record<string, unknown>;
      expect(accepted).toMatchObject({ status: 'done', acceptedById: mod.id });
      expect(accepted.completedAt).not.toBeNull();
    });
  });
});
