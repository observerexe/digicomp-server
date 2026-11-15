import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { POINTS_TEMPLATES } from '../src/migrations/1815000000000-PointsTemplates';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  pointsTemplates,
  publishSheet,
  resetDb,
  TestUser,
  type AwardRow,
} from './helpers';

// Бали через документ (3.3б): «Відомість балів» — рядок = нарахування. Усі
// рядки — в одній транзакції публікації; помилка рядка — з його номером;
// скасування відомості знімає всі її нарахування; нарахування з відомості
// через /points не знімається; учасник бачить відомість, де він є в рядках.

type Res = { status: number; body: Record<string, any> };

const YEAR = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
}).format(new Date());

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

describe('Бали через відомість (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let mod2: TestUser;
  let a: TestUser;
  let b: TestUser;
  let sheet: string;

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
    sheet = await pointsTemplates(app);
  });

  const balance = async (u: TestUser) =>
    (await as(app, u).get('/api/points/me')).body.balance as number;
  const publish = (who: TestUser, rows: AwardRow[]) =>
    publishSheet(app, who, sheet, rows);
  /** A published «Відомість балів» by `who`: the document. */
  async function published(who: TestUser, rows: AwardRow[]) {
    const res = await publish(who, rows);
    expect(res.status).toBe(200);
    return res.body;
  }
  const entries = (paperId: string) =>
    ds.query<{ id: string; user_id: string; amount: number }[]>(
      `SELECT id, user_id, amount FROM points_ledger WHERE paper_id = $1 ORDER BY amount`,
      [paperId],
    );
  const ledgerSize = async () =>
    (
      await ds.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM points_ledger`,
      )
    )[0]!.n;

  describe('публікація', () => {
    it('кожен непорожній рядок — нарахування з посиланням на відомість; номер; аудит', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'чергування' },
        {},
        { member: b.id, amount: 7, reason: 'прибрав склад' },
      ]);
      expect(p).toMatchObject({
        status: 'published',
        number: `ВБ-${YEAR}-001`,
        targetType: 'points_entry',
        targetId: null,
      });
      // The empty row goes when published.
      expect(p.values.awards).toHaveLength(2);
      const rows = await entries(p.id);
      expect(rows.map((r) => [r.user_id, r.amount])).toEqual([
        [a.id, 5],
        [b.id, 7],
      ]);
      expect(await balance(a)).toBe(5);
      expect(await balance(b)).toBe(7);

      const me = await as(app, a).get('/api/points/me');
      expect(me.body.history[0]).toMatchObject({
        kind: 'manual',
        amount: 5,
        reason: 'чергування',
        createdBy: { id: mod.id },
        paper: { id: p.id, number: p.number },
      });

      const links = await ds.query<{ to_id: string }[]>(
        `SELECT to_id FROM record_links WHERE from_type = 'paper' AND from_id = $1 AND role = '@target' AND to_type = 'points_entry'`,
        [p.id],
      );
      expect(links.map((l) => l.to_id).sort()).toEqual(
        rows.map((r) => r.id).sort(),
      );
      const [log] = await ds.query<{ meta: Record<string, unknown> }[]>(
        `SELECT meta FROM audit_log WHERE action = 'paper.published' AND entity_id = $1`,
        [p.id],
      );
      expect((log!.meta.targetIds as string[]).sort()).toEqual(
        rows.map((r) => r.id).sort(),
      );
      const awarded = await ds.query<{ meta: Record<string, unknown> }[]>(
        `SELECT meta FROM audit_log WHERE action = 'points.awarded' ORDER BY (meta->>'amount')::int`,
      );
      expect(awarded.map((l) => l.meta.paperId)).toEqual([p.id, p.id]);
    });

    it('без рядків і з неповним рядком — PAPER_REQUIRED_MISSING з номером рядка', async () => {
      const none = await publish(mod, []);
      code(none, 400, 'PAPER_REQUIRED_MISSING');
      expect(none.body.field).toBe('awards');
      const half = await publish(mod, [
        { member: a.id, amount: 5, reason: 'r' },
        { member: b.id, reason: 'r' },
      ]);
      code(half, 400, 'PAPER_REQUIRED_MISSING');
      expect(half.body).toMatchObject({ field: 'awards', row: 1 });
      expect(await ledgerSize()).toBe(0);
    });

    it('межі балів — з поля запису: 0 у чернетці не зберігається', async () => {
      const res = await publish(mod, [{ member: a.id, amount: 0 }]);
      code(res, 400, 'PAPER_FIELD_INVALID');
      expect(res.body).toMatchObject({ field: 'awards', row: 0 });
    });

    it('модератор не собі: 403 з рядком, нічого не нараховано й номер не витрачено', async () => {
      const res = await publish(mod, [
        { member: a.id, amount: 5, reason: 'r' },
        { member: mod.id, amount: 5, reason: 'r' },
      ]);
      code(res, 403, 'SELF_ACTION_FORBIDDEN');
      expect(res.body).toMatchObject({ field: 'awards', row: 1 });
      expect(await ledgerSize()).toBe(0);
      const ok = await published(admin, [
        { member: mod.id, amount: 5, reason: 'r' },
      ]);
      expect(ok.number).toBe(`ВБ-${YEAR}-001`);
    });

    it('заблокованому — 404 з рядком', async () => {
      const blocked = await makeUser(app, Role.Member, { active: false });
      const res = await publish(mod, [
        { member: blocked.id, amount: 5, reason: 'r' },
      ]);
      code(res, 404, 'UNKNOWN_MEMBER');
      expect(res.body).toMatchObject({ field: 'awards', row: 0 });
    });

    it('учасник відомість не створює', async () => {
      code(
        await as(app, a).post('/api/papers').send({ templateId: sheet }),
        404,
        'TEMPLATE_NOT_FOUND',
      );
    });

    it('після публікації не змінюється', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'r' },
      ]);
      code(
        await as(app, mod)
          .patch(`/api/papers/${p.id}`)
          .send({
            revision: p.revision,
            values: { awards: [{ member: a.id, amount: 50, reason: 'r' }] },
          }),
        403,
        'NOT_ALLOWED',
      );
    });

    it('учасник бачить лише відомості, де він є в рядках', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'r' },
      ]);
      expect((await as(app, a).get(`/api/papers/${p.id}`)).status).toBe(200);
      const list = await as(app, a).get('/api/papers');
      expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
      expect((await as(app, b).get(`/api/papers/${p.id}`)).status).toBe(404);
      expect((await as(app, b).get('/api/papers')).body.items).toEqual([]);
    });

    it('друк — рядок на нарахування', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'чергування' },
        { member: b.id, amount: 7, reason: 'склад' },
      ]);
      const res = await as(app, a).get(`/api/papers/${p.id}/print`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('чергування');
      expect(res.text).toContain('склад');
    });

    it('документ для старого нарахування не робиться', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'r' },
      ]);
      const [entry] = await entries(p.id);
      code(
        await as(app, admin)
          .post('/api/papers/for-record')
          .send({ templateId: sheet, targetId: entry!.id }),
        400,
        'TEMPLATE_KIND_INVALID',
      );
    });
  });

  describe('зняття', () => {
    it('скасування відомості знімає всі її нарахування; модератор — лише свою; аудит', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'r' },
        { member: b.id, amount: 7, reason: 'r' },
      ]);
      code(
        await as(app, mod2)
          .post(`/api/papers/${p.id}/cancel`)
          .send({ reason: 'x' }),
        403,
        'NOT_OWNER',
      );
      expect(await balance(a)).toBe(5);
      const res = await as(app, mod)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'помилка у відомості' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'помилка у відомості',
      });
      expect(await balance(a)).toBe(0);
      expect(await balance(b)).toBe(0);
      const me = await as(app, a).get('/api/points/me');
      expect(
        me.body.history.find((h: { amount: number }) => h.amount === 5),
      ).toMatchObject({ revoked: true, paper: { id: p.id } });
      const revoked = await ds.query<{ meta: Record<string, unknown> }[]>(
        `SELECT meta FROM audit_log WHERE action = 'points.revoked'`,
      );
      expect(revoked).toHaveLength(2);
      expect(revoked[0]!.meta).toMatchObject({
        reason: 'помилка у відомості',
        byPaper: true,
      });
    });

    it('адмін скасовує будь-яку відомість', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'r' },
      ]);
      expect(
        (
          await as(app, admin)
            .post(`/api/papers/${p.id}/cancel`)
            .send({ reason: 'x' })
        ).status,
      ).toBe(200);
      expect(await balance(a)).toBe(0);
    });

    it('нарахування з відомості через /points не знімається: 409 POINTS_HAS_PAPER', async () => {
      const p = await published(mod, [
        { member: a.id, amount: 5, reason: 'r' },
      ]);
      const [entry] = await entries(p.id);
      code(
        await as(app, mod)
          .post(`/api/points/${entry!.id}/revoke`)
          .send({ reason: 'x' }),
        409,
        'POINTS_HAS_PAPER',
      );
      expect(await balance(a)).toBe(5);
    });
  });

  it('«про кого»: учасник — у перший рядок відомості; список шаблонів це каже', async () => {
    const p = await as(app, mod)
      .post('/api/papers')
      .send({ templateId: sheet, about: { type: 'user', id: a.id } });
    expect(p.status).toBe(201);
    expect(p.body.values).toEqual({ awards: [{ member: a.id }] });
    const list = await as(app, mod).get('/api/papers/templates');
    expect(list.body.find((t: { id: string }) => t.id === sheet).about).toEqual(
      ['user'],
    );
  });

  it('версія шаблону з необов’язковими рядками, прив’язаними до запису, не публікується', async () => {
    const T = '/api/papers/templates';
    const [t] = POINTS_TEMPLATES;
    const v = await as(app, mod).post(`${T}/${sheet}/versions`);
    expect(v.status).toBe(201);
    const fields = t!.fields.map((f) =>
      f.key === 'awards' ? { ...f, required: false } : f,
    );
    const saved = await as(app, mod)
      .patch(`${T}/${sheet}/versions/2`)
      .send({ revision: 1, body: t!.body, fields });
    expect(saved.status).toBe(200);
    const res = await as(app, mod).post(`${T}/${sheet}/versions/2/publish`);
    code(res, 400, 'TEMPLATE_FIELD_INVALID');
    expect(res.body.field).toBe('awards');
  });
});
