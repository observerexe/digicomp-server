import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

// Бали (ручне нарахування, зняття), дисципліна (штраф знімає бали,
// зняття повертає), видимість записів і рейтинг.

type Res = { status: number; body: Record<string, any> };

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

describe('Бали і дисципліна (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let a: TestUser;
  let b: TestUser;

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
    a = await makeUser(app, Role.Member);
    b = await makeUser(app, Role.Member);
  });

  const balance = async (u: TestUser) =>
    (await as(app, u).get('/api/points/me')).body.balance as number;
  const award = (
    who: TestUser,
    to: TestUser,
    amount: number,
    reason = 'чергування',
  ) =>
    as(app, who)
      .post('/api/points/award')
      .send({ userId: to.id, amount, reason });
  const issue = (who: TestUser, body: Record<string, unknown>) =>
    as(app, who).post('/api/discipline').send(body);

  describe('ручне нарахування', () => {
    it('нараховує і показує в історії, хто нарахував', async () => {
      const res = await award(mod, a, 5, 'прибрав склад');
      expect(res.status).toBe(201);
      expect(await balance(a)).toBe(5);
      const me = await as(app, a).get('/api/points/me');
      expect(me.body.history[0]).toMatchObject({
        kind: 'manual',
        amount: 5,
        reason: 'прибрав склад',
        createdBy: { id: mod.id, name: mod.name },
        revoked: false,
      });
    });

    it('валідація: сума > 0, причина обов’язкова', async () => {
      code(await award(mod, a, 0), 400, 'VALIDATION_ERROR');
      code(await award(mod, a, -5), 400, 'VALIDATION_ERROR');
      code(await award(mod, a, 5, ' '), 400, 'VALIDATION_ERROR');
    });

    it('заблокованому чи невідомому — ні', async () => {
      const blocked = await makeUser(app, Role.Member, { active: false });
      code(await award(mod, blocked, 5), 404, 'UNKNOWN_MEMBER');
    });

    it('зняття: компенсаційний запис, повторно не можна', async () => {
      const e = await award(mod, a, 5);
      const r = await as(app, mod)
        .post(`/api/points/${e.body.id}/revoke`)
        .send({ reason: 'помилково' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        kind: 'reversal',
        amount: -5,
        reversesId: e.body.id,
      });
      expect(await balance(a)).toBe(0);
      code(
        await as(app, admin)
          .post(`/api/points/${e.body.id}/revoke`)
          .send({ reason: 'x' }),
        409,
        'ALREADY_REVOKED',
      );
      const me = await as(app, a).get('/api/points/me');
      expect(
        me.body.history.find((h: { id: string }) => h.id === e.body.id),
      ).toMatchObject({
        revoked: true,
      });
      const rows = await ds.query<unknown[]>(
        `SELECT 1 FROM points_ledger WHERE user_id = $1`,
        [a.id],
      );
      expect(rows).toHaveLength(2);
    });

    it('бали за ТЗ і штрафи через /points не знімаються', async () => {
      const f = await issue(mod, {
        userId: a.id,
        type: 'fine',
        reason: 'r',
        amount: 2,
      });
      const [entry] = await ds.query<{ id: string }[]>(
        `SELECT id FROM points_ledger WHERE user_id = $1`,
        [a.id],
      );
      expect(f.status).toBe(201);
      code(
        await as(app, admin)
          .post(`/api/points/${entry.id}/revoke`)
          .send({ reason: 'x' }),
        409,
        'ENTRY_NOT_REVOCABLE',
      );
    });

    it('чужу історію бачать лише модератори й адмін', async () => {
      await award(mod, a, 5);
      const res = await as(app, mod).get(`/api/points/users/${a.id}`);
      expect(res.body.balance).toBe(5);
      code(await as(app, b).get(`/api/points/users/${a.id}`), 403, 'FORBIDDEN');
    });
  });

  describe('дисципліна', () => {
    it('штраф знімає бали, зняття штрафу повертає', async () => {
      await award(admin, a, 10);
      const fine = await issue(mod, {
        userId: a.id,
        type: 'fine',
        reason: 'не прибрав за собою',
        amount: 4,
      });
      expect(fine.status).toBe(201);
      expect(fine.body).toMatchObject({
        type: 'fine',
        amount: 4,
        revoked: false,
        issuedBy: { id: mod.id },
      });
      expect(await balance(a)).toBe(6);

      const rev = await as(app, mod)
        .post(`/api/discipline/${fine.body.id}/revoke`)
        .send({ reason: 'розібрались' });
      expect(rev.status).toBe(200);
      expect(rev.body).toMatchObject({
        revoked: true,
        revokeReason: 'розібрались',
        revokedBy: { id: mod.id },
      });
      expect(await balance(a)).toBe(10);
      code(
        await as(app, mod)
          .post(`/api/discipline/${fine.body.id}/revoke`)
          .send({ reason: 'x' }),
        409,
        'ALREADY_REVOKED',
      );
      expect(await balance(a)).toBe(10);
    });

    it('попередження і догана балів не чіпають', async () => {
      await award(admin, a, 3);
      expect(
        (await issue(mod, { userId: a.id, type: 'warning', reason: 'r' }))
          .status,
      ).toBe(201);
      expect(
        (await issue(mod, { userId: a.id, type: 'reprimand', reason: 'r' }))
          .status,
      ).toBe(201);
      expect(await balance(a)).toBe(3);
    });

    it('сума лише для штрафу і обов’язкова для нього', async () => {
      code(
        await issue(mod, { userId: a.id, type: 'fine', reason: 'r' }),
        400,
        'FINE_AMOUNT_REQUIRED',
      );
      code(
        await issue(mod, {
          userId: a.id,
          type: 'warning',
          reason: 'r',
          amount: 3,
        }),
        400,
        'AMOUNT_ONLY_FOR_FINE',
      );
      code(
        await issue(mod, { userId: a.id, type: 'ban', reason: 'r' }),
        400,
        'VALIDATION_ERROR',
      );
    });

    it('учасник бачить лише свої записи разом з тим, хто видав', async () => {
      await issue(mod, { userId: a.id, type: 'warning', reason: 'для А' });
      await issue(mod, { userId: b.id, type: 'reprimand', reason: 'для Б' });
      const mine = await as(app, a).get('/api/discipline/me');
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({
        reason: 'для А',
        user: { id: a.id },
        issuedBy: { id: mod.id, name: mod.name },
      });
      code(await as(app, a).get('/api/discipline'), 403, 'FORBIDDEN');
      code(
        await as(app, a).get(`/api/discipline?userId=${b.id}`),
        403,
        'FORBIDDEN',
      );
    });

    it('таблиця для модераторів: фільтри і сторінки', async () => {
      const w = await issue(mod, {
        userId: a.id,
        type: 'warning',
        reason: '1',
      });
      await issue(mod, { userId: b.id, type: 'warning', reason: '2' });
      await as(app, mod)
        .post(`/api/discipline/${w.body.id}/revoke`)
        .send({ reason: 'x' });

      const all = await as(app, mod).get('/api/discipline');
      expect(all.body).toMatchObject({ total: 2, page: 1, limit: 50 });
      const ofA = await as(app, mod).get(`/api/discipline?userId=${a.id}`);
      expect(ofA.body.items).toHaveLength(1);
      const active = await as(app, mod).get('/api/discipline?state=active');
      expect(
        active.body.items.map((r: { reason: string }) => r.reason),
      ).toEqual(['2']);
      const revoked = await as(app, admin).get('/api/discipline?state=revoked');
      expect(
        revoked.body.items.map((r: { reason: string }) => r.reason),
      ).toEqual(['1']);
    });

    it('зняття пишеться в аудит', async () => {
      const w = await issue(mod, {
        userId: a.id,
        type: 'warning',
        reason: 'r',
      });
      await as(app, admin)
        .post(`/api/discipline/${w.body.id}/revoke`)
        .send({ reason: 'x' });
      const [log] = await ds.query<
        { actor_id: string; meta: Record<string, unknown> }[]
      >(
        `SELECT actor_id, meta FROM audit_log WHERE action = 'discipline.revoked' AND entity_id = $1`,
        [a.id],
      );
      expect(log).toMatchObject({
        actor_id: admin.id,
        meta: { recordId: w.body.id },
      });
    });
  });

  describe('рейтинг', () => {
    type Row = {
      id: string;
      total: number;
      rank: number;
      avatarUrl: string | null;
    };
    const board = async (period?: string) =>
      (
        await as(app, a).get(
          `/api/points/leaderboard${period ? `?period=${period}` : ''}`,
        )
      ).body as Row[];

    it('без заблокованих, з аватарами і місцями', async () => {
      const blocked = await makeUser(app, Role.Member, { active: false });
      await ds.query(
        `INSERT INTO points_ledger (user_id, amount, kind, reason) VALUES ($1, 100, 'manual', 'r')`,
        [blocked.id],
      );
      await award(mod, a, 7);
      await award(mod, b, 7);
      await award(admin, mod, 3);

      const rows = await board();
      expect(rows.map((r) => r.id)).not.toContain(blocked.id);
      expect(rows[0]).toHaveProperty('avatarUrl');
      expect(rows[0]).toHaveProperty('position');
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[a.id]).toMatchObject({ total: 7, rank: 1 });
      expect(byId[b.id]).toMatchObject({ total: 7, rank: 1 });
      expect(byId[mod.id]).toMatchObject({ total: 3, rank: 3 });
      expect(byId[admin.id]).toMatchObject({ total: 0, rank: 4 });
    });

    it('«цей місяць» не враховує минулі місяці', async () => {
      await ds.query(
        `INSERT INTO points_ledger (user_id, amount, kind, reason, created_at)
         VALUES ($1, 50, 'manual', 'старе', now() - interval '45 days')`,
        [a.id],
      );
      await award(mod, a, 2);
      const byId = (rows: Row[]) =>
        Object.fromEntries(rows.map((r) => [r.id, r.total]));
      expect(byId(await board('all'))[a.id]).toBe(52);
      expect(byId(await board('month'))[a.id]).toBe(2);
      expect(
        (await as(app, a).get('/api/points/leaderboard?period=week')).status,
      ).toBe(400);
    });

    it('знятий штраф з минулого місяця не дає плюса в цьому', async () => {
      const [fine] = await ds.query<{ id: string }[]>(
        `INSERT INTO points_ledger (user_id, amount, kind, reason, created_by_id, created_at)
         VALUES ($1, -5, 'fine', 'r', $2, now() - interval '45 days') RETURNING id`,
        [a.id, mod.id],
      );
      await ds.query(
        `INSERT INTO discipline_records (user_id, type, reason, amount, issued_by_id, ledger_entry_id, created_at)
         VALUES ($1, 'fine', 'r', 5, $2, $3, now() - interval '45 days')`,
        [a.id, mod.id, fine.id],
      );
      const [rec] = await ds.query<{ id: string }[]>(
        `SELECT id FROM discipline_records`,
      );
      await as(app, mod)
        .post(`/api/discipline/${rec.id}/revoke`)
        .send({ reason: 'x' });

      const month = Object.fromEntries(
        (await board('month')).map((r) => [r.id, r.total]),
      );
      expect(month[a.id]).toBe(0);
      expect(await balance(a)).toBe(0);
    });

    it('публічний профіль показує бали', async () => {
      await award(mod, a, 6);
      const res = await as(app, b).get(`/api/users/${a.id}`);
      expect(res.body.pointsTotal).toBe(6);
    });
  });
});
