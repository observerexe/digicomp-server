import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  authorizationTemplates,
  category,
  createTestApp,
  grantByPaper,
  makeUser,
  oldAuthorization,
  resetDb,
  TestUser,
  SIGNED,
} from './helpers';

// Допуск через документ (4.4): «Запис про інструктаж і допуск» видає допуск,
// повторний інструктаж оновлює його й стає його документом; скасування
// документа, що видав чинний строк, знімає допуск (раніший — ні); допуск
// з документом напряму не відкликається; старий отримує документ.

type Res = { status: number; body: Record<string, any> };

const YEAR = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
}).format(new Date());

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

describe('Допуск через документ (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let a: TestUser;
  let b: TestUser;
  let template: string;
  let placeId: string;

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
    template = await authorizationTemplates(app);
    const cat = await category(app, 'place_category', 'Верстати');
    placeId = (
      await as(app, admin)
        .post('/api/places')
        .send({ code: 'LASER-1', title: 'Лазер', category: cat })
        .expect(201)
    ).body.id;
  });

  const grant = (
    by: TestUser,
    values: Partial<{ userId: string; expiresAt: string; note: string }> = {},
  ) => grantByPaper(app, by, template, { userId: a.id, placeId, ...values });

  const auths = async () =>
    (
      await as(app, mod)
        .get('/api/place-authorizations')
        .query({ placeId })
        .expect(200)
    ).body as Record<string, any>[];

  const start = (u: TestUser) =>
    as(app, u)
      .post(`/api/places/${placeId}/sessions`)
      .send({ safetyConfirmed: true });

  const cancel = (by: TestUser, id: string, reason = 'помилка') =>
    as(app, by).post(`/api/papers/${id}/cancel`).send({ reason });

  const audits = (action: string) =>
    ds.getRepository(AuditLog).find({
      where: { action, entityId: placeId },
      order: { createdAt: 'ASC' },
    });

  it('публікація видає допуск: документ зафіксовано, з номером, допуск — з посиланням на документ', async () => {
    code(await start(a), 403, 'NOT_AUTHORIZED_FOR_PLACE');
    const until = new Date(Date.now() + 30 * 86400_000).toISOString();
    const res = await grant(mod, { expiresAt: until, note: 'під наглядом' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'frozen',
      number: `ІД-${YEAR}-001`,
      targetType: 'place_authorization',
      canChange: false,
    });
    const [row] = await auths();
    expect(row).toMatchObject({
      id: res.body.targetId,
      user: { id: a.id },
      expiresAt: until,
      note: 'під наглядом',
      grantedById: mod.id,
      paper: { id: res.body.id, number: `ІД-${YEAR}-001` },
    });
    expect((await start(a)).status).toBe(201);
    const [log] = await audits('authorization.granted');
    expect(log!.meta).toMatchObject({ userId: a.id, paperId: res.body.id });
  });

  it('учасник не видає допуск; неактивний учасник і архівне обладнання — помилка поля', async () => {
    // Шаблон модераторів: учасник його не бачить.
    code(
      await as(app, a).post('/api/papers').send({ templateId: template }),
      404,
      'TEMPLATE_NOT_FOUND',
    );
    await as(app, admin)
      .patch(`/api/users/${b.id}`)
      .send({ active: false })
      .expect(200);
    const inactive = await grant(mod, { userId: b.id });
    code(inactive, 400, 'PAPER_FIELD_INVALID');
    expect(inactive.body.field).toBe('userId');
    await as(app, admin)
      .patch(`/api/places/${placeId}`)
      .send({ status: 'archived' })
      .expect(200);
    const archived = await grant(mod);
    code(archived, 400, 'PAPER_FIELD_INVALID');
    expect(archived.body.field).toBe('placeId');
    expect(await auths()).toEqual([]);
  });

  it('повторний інструктаж оновлює той самий допуск; скасування раніщого документа його не знімає, чинного — знімає', async () => {
    const first = await grant(mod, {
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    expect(first.status).toBe(200);
    const later = new Date(Date.now() + 90 * 86400_000).toISOString();
    const second = await grant(admin, { expiresAt: later });
    expect(second.status).toBe(200);
    expect(second.body.targetId).toBe(first.body.targetId);
    const [row] = await auths();
    expect(row).toMatchObject({
      id: first.body.targetId,
      expiresAt: later,
      grantedById: admin.id,
      paper: { id: second.body.id },
    });
    const [, renewed] = await audits('authorization.granted');
    expect(renewed!.meta).toMatchObject({ renewed: true });

    expect((await cancel(mod, first.body.id)).status).toBe(200);
    expect(await auths()).toHaveLength(1);
    expect((await start(a)).status).toBe(201);
    expect(await audits('authorization.revoked')).toEqual([]);

    const off = await cancel(mod, second.body.id, 'порушив правила');
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('cancelled');
    expect(await auths()).toEqual([]);
    const [revoked] = await audits('authorization.revoked');
    expect(revoked!.meta).toMatchObject({
      userId: a.id,
      reason: 'порушив правила',
      byPaper: true,
    });
  });

  it('допуск з документом напряму не відкликається; старий — відкликається', async () => {
    const res = await grant(mod);
    code(
      await as(app, mod).delete(
        `/api/place-authorizations/${res.body.targetId}`,
      ),
      409,
      'AUTHORIZATION_HAS_PAPER',
    );
    const old = await oldAuthorization(app, mod, b, placeId);
    await as(app, mod)
      .delete(`/api/place-authorizations/${old.id}`)
      .expect(200);
    expect((await auths()).map((r) => r.user.id)).toEqual([a.id]);
  });

  it('старий допуск отримує документ (лише staff, один раз); тоді напряму не відкликається', async () => {
    const until = new Date(Date.now() + 86400_000);
    const old = await oldAuthorization(app, mod, a, placeId, until);
    const forRecord = (u: TestUser) =>
      as(app, u)
        .post('/api/papers/for-record')
        .send({ templateId: template, targetId: old.id, ...SIGNED });
    code(await forRecord(a), 404, 'TEMPLATE_NOT_FOUND');
    const p = await forRecord(mod);
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({
      targetType: 'place_authorization',
      targetId: old.id,
      values: { userId: a.id, placeId, expiresAt: until.toISOString() },
    });
    expect((await auths())[0]!.paper).toMatchObject({ id: p.body.id });
    code(await forRecord(admin), 409, 'PAPER_TARGET_TAKEN');
    code(
      await as(app, mod).delete(`/api/place-authorizations/${old.id}`),
      409,
      'AUTHORIZATION_HAS_PAPER',
    );
  });

  it('учасник бачить документи про свій допуск — і після скасування; інший учасник — ні', async () => {
    const res = await grant(mod);
    const id = res.body.id as string;
    expect((await as(app, a).get(`/api/papers/${id}`)).status).toBe(200);
    expect((await as(app, b).get(`/api/papers/${id}`)).status).toBe(404);
    await cancel(mod, id).expect(200);
    expect((await as(app, a).get(`/api/papers/${id}`)).status).toBe(200);
    expect((await as(app, b).get(`/api/papers/${id}`)).status).toBe(404);
  });

  it('«про кого» під час створення: обладнання чи учасник — у своє поле', async () => {
    const aboutPlace = await as(app, mod)
      .post('/api/papers')
      .send({ templateId: template, about: { type: 'place', id: placeId } });
    expect(aboutPlace.status).toBe(201);
    expect(aboutPlace.body.values).toEqual({ placeId });
    const aboutUser = await as(app, mod)
      .post('/api/papers')
      .send({ templateId: template, about: { type: 'user', id: a.id } });
    expect(aboutUser.body.values).toEqual({ userId: a.id });
  });

  it('POST /place-authorizations більше немає', async () => {
    expect(
      (
        await as(app, mod)
          .post('/api/place-authorizations')
          .send({ userId: a.id, placeId })
      ).status,
    ).toBe(404);
  });
});
