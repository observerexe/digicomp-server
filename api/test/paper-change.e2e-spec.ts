import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  resetDb,
  TestUser,
  SIGNED,
} from './helpers';

// Авто-поля й зміна опублікованого документа (3.1в): авто-поля ніхто не
// заповнює, після публікації вони показують ТЗ; поля «можна змінити» —
// прив'язані змінюють ТЗ (права ТЗ, до «Виконано»), неприв'язані — автор
// документа чи модератор і адмін; решта не змінюється.

type Field = Record<string, unknown> & { key: string; type: string };
type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Paper = {
  id: string;
  status: string;
  revision: number;
  content: Node;
  values: Record<string, unknown>;
  targetId: string | null;
  refs: { type: string; id: string; title: string }[];
  canChange: boolean;
  template: {
    fields: { key: string; auto: boolean; canFill: boolean }[];
  } | null;
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

const form = (fields: Field[]): Node => ({
  type: 'doc',
  content: fields.map((f): Node =>
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
});

const withZone = (doc: Node, key: string, text: string): Node => ({
  ...doc,
  content: doc.content!.map((n) =>
    n.type === 'fieldZone' && n.attrs?.key === key
      ? {
          ...n,
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        }
      : n,
  ),
});

const zoneText = (doc: Node, key: string) =>
  doc
    .content!.find((n) => n.type === 'fieldZone' && n.attrs?.key === key)!
    .content!.map((p) => (p.content ?? []).map((t) => t.text).join(''))
    .join('\n');

/** «Технічне завдання»: що потрібно ТЗ, «можна змінити», і авто-поля. */
const TASK_FIELDS: Field[] = [
  field('name', { binding: 'title', required: true, editable: true }),
  field('goal', { type: 'richtext', binding: 'description', editable: true }),
  field('points', {
    type: 'int',
    binding: 'points',
    required: true,
    editable: true,
  }),
  field('size', { type: 'int', binding: 'maxAssignees', editable: true }),
  field('note', { editable: true }),
  field('fixed', {}),
  field('team', { type: 'list<ref:user>', binding: 'assignees' }),
  field('split', { binding: 'pointsSplit' }),
  field('accepted', { type: 'ref:user', binding: 'acceptedById' }),
  field('submitted', { type: 'datetime', binding: 'submittedAt' }),
];

describe('Авто-поля й зміна опублікованого документа (e2e)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let other: TestUser;

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
    member = await makeUser(app, Role.Member, { name: 'Олена Коваль' });
    other = await makeUser(app, Role.Member, { name: 'Іван Петренко' });
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
    const res = await as(app, mod).post(`${T}/${t.id}/versions/1/publish`);
    return { id: t.id, publish: res };
  };
  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const patch = (u: TestUser, p: Paper, body: Record<string, unknown>) =>
    as(app, u)
      .patch(`/api/papers/${p.id}`)
      .send({ revision: p.revision, ...body });
  const audit = (action: string) =>
    app.get(DataSource).getRepository(AuditLog).findBy({ action });
  const act = (u: TestUser, id: string, what: string) =>
    as(app, u).post(`/api/tasks/${id}/${what}`).expect(200);
  const task = async (id: string) =>
    (await as(app, mod).get(`/api/tasks/${id}`).expect(200)).body as Record<
      string,
      unknown
    >;

  /** A published «Технічне завдання» of the moderator: ТЗ «Логотип» на 31 бал, до 2 виконавців. */
  const taskPaper = async () => {
    const { id } = await template(TASK_FIELDS, {
      kind: 'creates',
      target: 'task',
      creators: 'staff',
    });
    const p = (
      await as(app, mod)
        .post('/api/papers')
        .send({ templateId: id })
        .expect(201)
    ).body as Paper;
    await patch(mod, p, {
      values: { name: 'Логотип', points: 31, size: 2, note: 'а', fixed: 'б' },
      content: withZone(p.content, 'goal', 'Мета'),
    }).expect(200);
    await as(app, mod)
      .post(`/api/papers/${p.id}/publish`)
      .send(SIGNED)
      .expect(200);
    return get(mod, p.id);
  };

  describe('авто-поля', () => {
    it('шаблон: авто-поле не буває обов’язковим чи «можна змінити»', async () => {
      const bad = await template(
        [
          ...TASK_FIELDS.slice(0, 3),
          field('team', {
            type: 'list<ref:user>',
            binding: 'assignees',
            required: true,
          }),
        ],
        { kind: 'creates', target: 'task' },
      );
      expect(bad.publish.status).toBe(400);
      expect(bad.publish.body).toMatchObject({
        errorCode: 'TEMPLATE_FIELD_INVALID',
        field: 'team',
      });
    });

    it('у чернетці ніхто не заповнює; після публікації — із ТЗ', async () => {
      const { id } = await template(TASK_FIELDS, {
        kind: 'creates',
        target: 'task',
      });
      const draft = (
        await as(app, mod)
          .post('/api/papers')
          .send({ templateId: id })
          .expect(201)
      ).body as Paper;
      const team = draft.template!.fields.find((f) => f.key === 'team')!;
      expect(team).toMatchObject({ auto: true, canFill: false });
      expect(draft.template!.fields.find((f) => f.key === 'name')!.auto).toBe(
        false,
      );
      const refused = await patch(mod, draft, {
        values: { name: 'Логотип', points: 31, team: [member.id] },
      }).expect(400);
      expect(refused.body).toMatchObject({
        errorCode: 'PAPER_FIELD_INVALID',
        field: 'team',
      });

      const p = await taskPaper();
      expect(p.values.team).toBeUndefined();
      await act(member, p.targetId!, 'take');
      await act(other, p.targetId!, 'take');
      await act(member, p.targetId!, 'start');
      await act(member, p.targetId!, 'submit');
      await act(admin, p.targetId!, 'accept');

      const done = await get(other, p.id);
      expect(done.values).toMatchObject({
        team: [member.id, other.id],
        split: 'Олена КОВАЛЬ — 16; Іван ПЕТРЕНКО — 15',
        accepted: admin.id,
      });
      expect(typeof done.values.submitted).toBe('string');
      // Імена виконавців — серед записів документа.
      expect(done.refs.map((r) => r.id)).toEqual(
        expect.arrayContaining([member.id, other.id, admin.id]),
      );
      const printed = await as(app, other)
        .get(`/api/papers/${p.id}/print`)
        .expect(200);
      expect(printed.text).toContain('Олена КОВАЛЬ — 16');
    });
  });

  describe('прив’язані поля', () => {
    it('модератор змінює ТЗ через документ: одна зміна ТЗ, один запис аудиту', async () => {
      const p = await taskPaper();
      expect(p.canChange).toBe(true);
      expect(
        p.template!.fields.filter((f) => f.canFill).map((f) => f.key),
      ).toEqual(['name', 'goal', 'points', 'size', 'note']);
      const res = await patch(mod, p, {
        values: { ...p.values, name: 'Логотип 2', points: 40 },
        content: withZone(p.content, 'goal', 'Нова мета'),
      }).expect(200);
      expect(res.body.revision).toBe(p.revision + 1);
      expect(await task(p.targetId!)).toMatchObject({
        title: 'Логотип 2',
        points: 40,
        description: 'Нова мета',
      });
      const [updated] = await audit('task.updated');
      expect(updated.meta).toMatchObject({
        title: 'Логотип 2',
        points: 40,
        description: true,
      });
      expect(await audit('paper.updated')).toEqual([
        expect.objectContaining({
          actorId: mod.id,
          meta: expect.objectContaining({
            fields: ['goal', 'name', 'points'],
            targetId: p.targetId,
          }),
        }),
      ]);
      const now = await get(member, p.id);
      expect(now.values.name).toBe('Логотип 2');
      expect(zoneText(now.content, 'goal')).toBe('Нова мета');
    });

    it('без змін — ні ревізії, ні аудиту', async () => {
      const p = await taskPaper();
      const res = await patch(mod, p, {
        values: p.values,
        content: p.content,
      }).expect(200);
      expect(res.body.revision).toBe(p.revision);
      expect(await audit('paper.updated')).toHaveLength(0);
    });

    it('учасник не змінює ТЗ, навіть своє поле — 403; canChange — ні', async () => {
      const p = await taskPaper();
      const seen = await get(member, p.id);
      expect(seen.canChange).toBe(false);
      expect(seen.template!.fields.some((f) => f.canFill)).toBe(false);
      await patch(member, seen, {
        values: { ...seen.values, name: 'Інше' },
      }).expect(403);
      await patch(member, seen, {
        values: { ...seen.values, note: 'в' },
      }).expect(403);
      expect((await task(p.targetId!)).title).toBe('Логотип');
    });

    it('поле без «можна змінити» і текст поза зонами не змінюються', async () => {
      const p = await taskPaper();
      await patch(mod, p, {
        values: { ...p.values, fixed: 'в' },
      }).expect(403);
      const locked = await patch(mod, p, {
        content: {
          ...p.content,
          content: [
            ...p.content.content!,
            { type: 'paragraph', content: [{ type: 'text', text: 'ще' }] },
          ],
        },
      }).expect(400);
      expect(locked.body.errorCode).toBe('PAPER_CONTENT_LOCKED');
    });

    it('обов’язкове не спорожнюється; помилка ТЗ — з ключем поля', async () => {
      const p = await taskPaper();
      const { name: _name, ...rest } = p.values;
      const missing = await patch(mod, p, { values: rest }).expect(400);
      expect(missing.body).toMatchObject({
        errorCode: 'PAPER_REQUIRED_MISSING',
        field: 'name',
      });
      await act(member, p.targetId!, 'take');
      await act(other, p.targetId!, 'take');
      // Виконавці — уже в документі: він показує ТЗ як є.
      const taken = await get(mod, p.id);
      const low = await patch(mod, taken, {
        values: { ...taken.values, size: 1 },
      }).expect(409);
      expect(low.body).toMatchObject({
        errorCode: 'MAX_ASSIGNEES_TOO_LOW',
        field: 'size',
      });
      expect((await task(p.targetId!)).maxAssignees).toBe(2);
    });

    it('чужа ревізія — PAPER_CONFLICT', async () => {
      const p = await taskPaper();
      const res = await patch(
        mod,
        { ...p, revision: p.revision - 1 },
        {
          values: { ...p.values, note: 'в' },
        },
      ).expect(409);
      expect(res.body.errorCode).toBe('PAPER_CONFLICT');
    });

    it('після «Виконано» ТЗ не змінюється; неприв’язане — так', async () => {
      const p = await taskPaper();
      await act(member, p.targetId!, 'take');
      await act(member, p.targetId!, 'start');
      await act(member, p.targetId!, 'submit');
      await act(admin, p.targetId!, 'accept');
      const done = await get(mod, p.id);
      expect(
        done.template!.fields.filter((f) => f.canFill).map((f) => f.key),
      ).toEqual(['note']);
      await patch(mod, done, {
        values: { ...done.values, name: 'Інше' },
      }).expect(403);
      await patch(mod, done, {
        values: { ...done.values, note: 'в' },
      }).expect(200);
      expect((await get(member, p.id)).values.note).toBe('в');
    });
  });

  describe('неприв’язані поля', () => {
    /** A published document of `author` from a free template with fields «можна змінити». */
    const paper = async (author: TestUser) => {
      const { id } = await template(
        [field('note', { editable: true }), field('fixed')],
        { visibility: 'members' },
      );
      const p = (
        await as(app, author)
          .post('/api/papers')
          .send({ templateId: id })
          .expect(201)
      ).body as Paper;
      await patch(author, p, { values: { note: 'а', fixed: 'б' } }).expect(200);
      await as(app, author)
        .post(`/api/papers/${p.id}/publish`)
        .send(SIGNED)
        .expect(200);
      return get(author, p.id);
    };

    it('учасник змінює своє; аудит пише й зміну автора', async () => {
      const p = await paper(member);
      expect(p.canChange).toBe(true);
      await patch(member, p, { values: { note: 'в', fixed: 'б' } }).expect(200);
      expect((await get(member, p.id)).values).toEqual({
        note: 'в',
        fixed: 'б',
      });
      expect(await audit('paper.updated')).toHaveLength(1);
    });

    it('чужий учасник — ні (403); модератор і адмін — так', async () => {
      const p = await paper(member);
      const seen = await get(other, p.id);
      expect(seen.canChange).toBe(false);
      await patch(other, seen, { values: { note: 'в', fixed: 'б' } }).expect(
        403,
      );
      const r = await patch(mod, p, {
        values: { note: 'в', fixed: 'б' },
      }).expect(200);
      await patch(
        admin,
        { ...p, revision: r.body.revision as number },
        {
          values: { note: 'г', fixed: 'б' },
        },
      ).expect(200);
      expect((await get(member, p.id)).values.note).toBe('г');
    });

    it('скасований документ не змінюється', async () => {
      const p = await paper(member);
      const c = await as(app, member)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'Помилка' })
        .expect(200);
      const res = await patch(member, c.body as Paper, {
        values: { note: 'в', fixed: 'б' },
      }).expect(409);
      expect(res.body.errorCode).toBe('PAPER_NOT_DRAFT');
      expect((c.body as Paper).canChange).toBe(false);
    });
  });
});
