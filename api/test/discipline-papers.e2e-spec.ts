import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { DISCIPLINE_TEMPLATES } from '../src/migrations/1813000000000-DisciplineTemplates';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  disciplineTemplates,
  issueRecord,
  makeUser,
  oldAward,
  resetDb,
  TestUser,
} from './helpers';

// Дисципліна через документ (3.2): «Подання про стягнення» з умовним полем
// «Розмір штрафу», скасування документа знімає стягнення, старе стягнення
// з документом через /discipline не знімається, «Пояснювальна записка»
// посилається на стягнення.

type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Res = { status: number; body: Record<string, any> };

const YEAR = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
}).format(new Date());

/** The doc with the zone `key` holding this text. */
const withZone = (n: Node, key: string, text: string): Node =>
  n.type === 'fieldZone' && n.attrs?.key === key
    ? {
        ...n,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      }
    : n.content
      ? { ...n, content: n.content.map((c) => withZone(c, key, text)) }
      : n;

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

describe('Дисципліна через документ (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let mod2: TestUser;
  let a: TestUser;
  let b: TestUser;
  let templates: { issue: string; note: string };

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
    mod2 = await makeUser(app, Role.Moderator);
    a = await makeUser(app, Role.Member);
    b = await makeUser(app, Role.Member);
    templates = await disciplineTemplates(app);
  });

  const balance = async (u: TestUser) =>
    (await as(app, u).get('/api/points/me')).body.balance as number;

  /** A draft of «Подання» by `who` with these values and the reason written. */
  async function draft(
    who: TestUser,
    values: Record<string, unknown>,
    reason = 'не вимкнув паяльну станцію',
  ) {
    const p = await as(app, who)
      .post('/api/papers')
      .send({ templateId: templates.issue });
    expect(p.status).toBe(201);
    const saved = await as(app, who)
      .patch(`/api/papers/${p.body.id}`)
      .send({
        revision: p.body.revision,
        values,
        content: withZone(p.body.content as Node, 'reason', reason),
      });
    expect(saved.status).toBe(200);
    return { id: p.body.id as string, revision: saved.body.revision as number };
  }

  const publish = (who: TestUser, id: string) =>
    as(app, who).post(`/api/papers/${id}/publish`);

  /** A published «Подання» by `who`: the document. */
  async function issued(who: TestUser, values: Record<string, unknown>) {
    const d = await draft(who, values);
    const res = await publish(who, d.id);
    expect(res.status).toBe(200);
    return res.body;
  }

  describe('«Подання про стягнення»', () => {
    it('штраф: розмір обов’язковий, лише коли обрано «Штраф»; публікація видає стягнення й знімає бали', async () => {
      await oldAward(app, admin, a, 10, 'r');
      const d = await draft(mod, { userId: a.id, type: 'fine' });
      const missing = await publish(mod, d.id);
      code(missing, 400, 'PAPER_REQUIRED_MISSING');
      expect(missing.body.field).toBe('amount');

      await as(app, mod)
        .patch(`/api/papers/${d.id}`)
        .send({
          revision: d.revision,
          values: { userId: a.id, type: 'fine', amount: 4 },
        });
      const res = await publish(mod, d.id);
      expect(res.status).toBe(200);
      // «Подання» freezes itself: the record is ready at once (4.1).
      expect(res.body).toMatchObject({
        status: 'frozen',
        number: `ПС-${YEAR}-001`,
        targetType: 'discipline_record',
        canChange: false,
      });
      expect(await balance(a)).toBe(6);

      const list = await as(app, mod).get('/api/discipline');
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        id: res.body.targetId,
        type: 'fine',
        amount: 4,
        reason: 'не вимкнув паяльну станцію',
        issuedBy: { id: mod.id },
        paper: { id: d.id, number: `ПС-${YEAR}-001` },
        papers: [],
      });
      // The document shows the record.
      expect(res.body.values).toMatchObject({ type: 'fine', amount: 4 });
    });

    it('попередження: розмір штрафу, лишений у чернетці, не йде ні в запис, ні в документ', async () => {
      const d = await draft(mod, { userId: a.id, type: 'fine', amount: 5 });
      await as(app, mod)
        .patch(`/api/papers/${d.id}`)
        .send({
          revision: d.revision,
          values: { userId: a.id, type: 'warning', amount: 5 },
        });
      const res = await publish(mod, d.id);
      expect(res.status).toBe(200);
      expect(res.body.values).toEqual({ userId: a.id, type: 'warning' });
      const [rec] = await ds.query<{ type: string; amount: number | null }[]>(
        `SELECT type, amount FROM discipline_records WHERE id = $1`,
        [res.body.targetId],
      );
      expect(rec).toEqual({ type: 'warning', amount: null });
      expect(await balance(a)).toBe(0);
    });

    it('друк: «Розмір штрафу» лише для штрафу', async () => {
      const fine = await issued(mod, { userId: a.id, type: 'fine', amount: 3 });
      const warn = await issued(mod, { userId: a.id, type: 'warning' });
      const print = async (id: string) =>
        (await as(app, mod).get(`/api/papers/${id}/print`)).text;
      expect(await print(fine.id)).toContain('Розмір штрафу, балів');
      expect(await print(warn.id)).not.toContain('Розмір штрафу');
    });

    it('модератор не собі: 403, нічого не видано й номер не витрачено', async () => {
      const d = await draft(mod, { userId: mod.id, type: 'warning' });
      code(await publish(mod, d.id), 403, 'SELF_ACTION_FORBIDDEN');
      const [{ n }] = await ds.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM discipline_records`,
      );
      expect(n).toBe(0);
      const ok = await issued(admin, { userId: mod.id, type: 'warning' });
      expect(ok.number).toBe(`ПС-${YEAR}-001`);
    });

    it('учасник подання не створює', async () => {
      const res = await as(app, a)
        .post('/api/papers')
        .send({ templateId: templates.issue });
      code(res, 404, 'TEMPLATE_NOT_FOUND');
    });

    it('учасник бачить лише подання про себе', async () => {
      const p = await issued(mod, { userId: a.id, type: 'reprimand' });
      expect((await as(app, a).get(`/api/papers/${p.id}`)).status).toBe(200);
      const mine = await as(app, a).get('/api/papers');
      expect(mine.body.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
      expect((await as(app, b).get(`/api/papers/${p.id}`)).status).toBe(404);
      expect((await as(app, b).get('/api/papers')).body.items).toEqual([]);
      const me = await as(app, a).get('/api/discipline/me');
      expect(me.body[0].paper).toEqual({ id: p.id, number: p.number });
    });

    it('після публікації не змінюється', async () => {
      const p = await issued(mod, { userId: a.id, type: 'warning' });
      code(
        await as(app, mod)
          .patch(`/api/papers/${p.id}`)
          .send({
            revision: p.revision,
            values: { userId: a.id, type: 'reprimand' },
          }),
        409,
        'PAPER_NOT_DRAFT',
      );
    });
  });

  describe('зняття', () => {
    it('скасування документа знімає стягнення й повертає бали; аудит', async () => {
      await oldAward(app, admin, a, 10, 'r');
      const p = await issued(mod, { userId: a.id, type: 'fine', amount: 4 });
      expect(await balance(a)).toBe(6);
      // A moderator revokes only what they issued.
      code(
        await as(app, mod2)
          .post(`/api/papers/${p.id}/cancel`)
          .send({ reason: 'x' }),
        403,
        'NOT_OWNER',
      );
      const res = await as(app, mod)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'розібрались' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'розібрались',
      });
      expect(await balance(a)).toBe(10);
      const [rec] = (await as(app, mod).get('/api/discipline')).body.items;
      expect(rec).toMatchObject({
        revoked: true,
        revokeReason: 'розібрались',
        revokedBy: { id: mod.id },
      });
      const [log] = await ds.query<{ meta: Record<string, unknown> }[]>(
        `SELECT meta FROM audit_log WHERE action = 'discipline.revoked'`,
      );
      expect(log.meta).toMatchObject({ recordId: p.targetId, byPaper: true });
    });

    it('адмін скасовує будь-яке подання', async () => {
      const p = await issued(mod, { userId: a.id, type: 'warning' });
      const res = await as(app, admin)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'x' });
      expect(res.status).toBe(200);
    });

    it('стягнення з документом через /discipline не знімається: 409 DISCIPLINE_HAS_PAPER', async () => {
      const p = await issued(mod, { userId: a.id, type: 'warning' });
      code(
        await as(app, mod)
          .post(`/api/discipline/${p.targetId}/revoke`)
          .send({ reason: 'x' }),
        409,
        'DISCIPLINE_HAS_PAPER',
      );
      // Made before documents — as before.
      const old = await issueRecord(app, mod, {
        userId: a.id,
        type: 'warning',
        reason: 'r',
      });
      const res = await as(app, mod)
        .post(`/api/discipline/${old.body.id}/revoke`)
        .send({ reason: 'x' });
      expect(res.status).toBe(200);
      expect(res.body.paper).toBeNull();
    });
  });

  describe('«Пояснювальна записка»', () => {
    it('учасник пише записку на своє стягнення; модератор бачить її біля стягнення, інший учасник — ні', async () => {
      const p = await issued(mod, { userId: a.id, type: 'warning' });
      const note = await as(app, a)
        .post('/api/papers')
        .send({
          templateId: templates.note,
          about: { type: 'discipline_record', id: p.targetId },
        });
      expect(note.status).toBe(201);
      expect(note.body.values).toEqual({ record: p.targetId });
      const ref = note.body.refs.find(
        (r: { type: string }) => r.type === 'discipline_record',
      );
      expect(ref.title).toMatch(/^Попередження · /);

      const filled = await as(app, a)
        .patch(`/api/papers/${note.body.id}`)
        .send({
          revision: note.body.revision,
          content: withZone(note.body.content as Node, 'text', 'Забув.'),
        });
      expect(filled.status).toBe(200);
      expect(
        (await as(app, a).post(`/api/papers/${note.body.id}/publish`)).status,
      ).toBe(200);

      const me = await as(app, a).get('/api/discipline/me');
      expect(me.body[0].papers).toEqual([
        {
          id: note.body.id,
          title: 'Пояснювальна записка',
          number: null,
          status: 'published',
        },
      ]);
      const staff = await as(app, mod).get('/api/discipline');
      expect(staff.body.items[0].papers).toHaveLength(1);
      expect((await as(app, b).get(`/api/papers/${note.body.id}`)).status).toBe(
        404,
      );
    });

    it('на чуже стягнення — ні: 400 PAPER_FIELD_INVALID', async () => {
      const p = await issued(mod, { userId: a.id, type: 'warning' });
      const res = await as(app, b)
        .post('/api/papers')
        .send({
          templateId: templates.note,
          about: { type: 'discipline_record', id: p.targetId },
        });
      code(res, 400, 'PAPER_FIELD_INVALID');
      expect(res.body.field).toBe('record');
    });

    it('пошук стягнень для поля: учасник — лише свої, модератор — усі', async () => {
      await issued(mod, { userId: a.id, type: 'warning' });
      await issued(mod, { userId: b.id, type: 'reprimand' });
      const search = (who: TestUser) =>
        as(app, who).get('/api/links/candidates?type=discipline_record');
      const own = await search(a);
      expect(own.status).toBe(200);
      expect(own.body).toHaveLength(1);
      expect((await search(mod)).body).toHaveLength(2);
    });
  });

  it('«про кого» під час створення: у перше поле цього типу; без такого поля — порожньо; вільний документ — ні', async () => {
    const p = await as(app, mod)
      .post('/api/papers')
      .send({ templateId: templates.issue, about: { type: 'user', id: a.id } });
    expect(p.status).toBe(201);
    expect(p.body.values).toEqual({ userId: a.id });
    const none = await as(app, mod)
      .post('/api/papers')
      .send({ templateId: templates.issue, about: { type: 'task', id: a.id } });
    expect(none.status).toBe(201);
    expect(none.body.values).toEqual({});
    code(
      await as(app, mod)
        .post('/api/papers')
        .send({ about: { type: 'user', id: a.id } }),
      400,
      'VALIDATION_ERROR',
    );
    code(
      await as(app, mod)
        .post('/api/papers')
        .send({
          templateId: templates.issue,
          about: { type: 'nope', id: a.id },
        }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('список шаблонів каже, про які записи може бути документ', async () => {
    const list = await as(app, a).get('/api/papers/templates');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: templates.note,
        about: ['discipline_record'],
      }),
    ]);
    const staff = await as(app, mod).get('/api/papers/templates');
    expect(
      staff.body.find((t: { id: string }) => t.id === templates.issue).about,
    ).toEqual(['user']);
  });

  describe('умовний блок', () => {
    it('у вільному документі — ні: 400 PAPER_CONTENT_LOCKED', async () => {
      const res = await as(app, a)
        .post('/api/papers')
        .send({
          content: {
            type: 'doc',
            content: [
              {
                type: 'conditional',
                attrs: { field: 'type', value: 'fine' },
                content: [{ type: 'paragraph' }],
              },
            ],
          },
        });
      code(res, 400, 'PAPER_CONTENT_LOCKED');
    });

    it('версія шаблону з умовою на варіант, якого в полі немає, не публікується', async () => {
      const T = '/api/papers/templates';
      const [issue] = DISCIPLINE_TEMPLATES;
      const v = await as(app, mod).post(`${T}/${templates.issue}/versions`);
      expect(v.status).toBe(201);
      const body = {
        ...issue.body,
        content: issue.body.content!.map((n) =>
          n.type === 'conditional'
            ? { ...n, attrs: { field: 'type', value: 'ban' } }
            : n,
        ),
      };
      const saved = await as(app, mod)
        .patch(`${T}/${templates.issue}/versions/2`)
        .send({ revision: 1, body, fields: issue.fields });
      expect(saved.status).toBe(200);
      const res = await as(app, mod).post(
        `${T}/${templates.issue}/versions/2/publish`,
      );
      code(res, 400, 'TEMPLATE_FIELD_INVALID');
      expect(res.body.field).toBe('type');
    });
  });
});
