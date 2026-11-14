import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

type Org = {
  institution: string;
  groupName: string;
  signer: { id: string; name: string; active: boolean } | null;
  signerPosition: string;
};

describe('Реквізити (e2e)', () => {
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

  const audit = () =>
    app
      .get(DataSource)
      .getRepository(AuditLog)
      .findBy({ action: 'org_settings.updated' });

  it('читають усі ролі; порожній рядок, якщо його немає', async () => {
    for (const u of [admin, mod, member]) {
      const res = await as(app, u).get('/api/org-settings');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        institution: '',
        groupName: '',
        signer: null,
        signerPosition: '',
      });
    }
  });

  it('учасник не змінює', async () => {
    const res = await as(app, member)
      .patch('/api/org-settings')
      .send({ institution: 'Х' });
    expect(res.status).toBe(403);
  });

  it('модератор змінює лише передані поля, себе теж може вибрати підписантом; аудит', async () => {
    await as(app, admin)
      .patch('/api/org-settings')
      .send({ institution: 'КОЛЕДЖ', groupName: 'Група' })
      .expect(200);
    const res = await as(app, mod)
      .patch('/api/org-settings')
      .send({ signerId: mod.id, signerPosition: '  модератор групи ' });
    expect(res.status).toBe(200);
    expect(res.body as Org).toEqual(
      expect.objectContaining({
        institution: 'КОЛЕДЖ',
        groupName: 'Група',
        signer: { id: mod.id, name: mod.name, active: true },
        signerPosition: 'модератор групи',
      }),
    );
    const log = await audit();
    expect(log).toHaveLength(2);
    const last = log.find((l) => l.actorId === mod.id);
    expect(last?.meta).toEqual({
      changes: {
        signerId: { from: null, to: mod.id },
        signerPosition: { from: '', to: 'модератор групи' },
      },
    });
  });

  it('без змін — без запису в аудиті', async () => {
    await as(app, mod).patch('/api/org-settings').send({ groupName: 'Г' });
    await as(app, mod).patch('/api/org-settings').send({ groupName: 'Г' });
    expect(await audit()).toHaveLength(1);
  });

  it('заблокований чи неіснуючий підписант — ORG_SIGNER_INVALID; null очищає', async () => {
    const blocked = await makeUser(app, Role.Member, { active: false });
    for (const signerId of [
      blocked.id,
      '00000000-0000-4000-8000-000000000001',
    ]) {
      const res = await as(app, mod)
        .patch('/api/org-settings')
        .send({ signerId });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('ORG_SIGNER_INVALID');
    }
    await as(app, mod).patch('/api/org-settings').send({ signerId: member.id });
    const res = await as(app, mod)
      .patch('/api/org-settings')
      .send({ signerId: null });
    expect((res.body as Org).signer).toBeNull();
  });

  it('підписанта заблокували — видно active: false', async () => {
    await as(app, mod).patch('/api/org-settings').send({ signerId: member.id });
    await as(app, admin)
      .patch(`/api/users/${member.id}`)
      .send({ active: false });
    const res = await as(app, mod).get('/api/org-settings');
    expect((res.body as Org).signer).toMatchObject({
      id: member.id,
      active: false,
    });
  });

  it('порожня назва — помилка перевірки', async () => {
    const res = await as(app, mod)
      .patch('/api/org-settings')
      .send({ institution: '   ' });
    expect(res.status).toBe(400);
  });
});
