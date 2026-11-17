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
} from './helpers';

// Колір акаунта (6.7е): нові акаунти отримують кольори по черзі; свій колір
// змінює кожен, чужий — лише адмін (з аудитом); колір іде разом з ім'ям і
// аватаром скрізь, де показано людину.

describe('Колір акаунта (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;

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
    member = await makeUser(app, Role.Member, { color: 'teal' });
  });

  const audit = (action: string) =>
    ds
      .getRepository(AuditLog)
      .find({ where: { action }, order: { createdAt: 'ASC' } });

  it('новий акаунт — наступний колір по черзі (сірий — лише за вибором)', async () => {
    const colors: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await as(app, admin)
        .post('/api/users')
        .send({
          email: `n${i}@test.local`,
          name: `Новий ${i}`,
          password: 'password-123',
        })
        .expect(201);
      colors.push(res.body.color as string);
    }
    // Three accounts are already there: the turn goes on from the fourth.
    expect(colors).toEqual([
      'purple',
      'teal',
      'red',
      'yellow',
      'blue',
      'green',
    ]);
  });

  it('свій колір — кожен; не з палітри — 400; аудит', async () => {
    const res = await as(app, member)
      .patch('/api/users/me')
      .send({ color: 'purple' })
      .expect(200);
    expect(res.body.color).toBe('purple');
    expect(
      (await as(app, member).get('/api/auth/me').expect(200)).body.color,
    ).toBe('purple');
    const bad = await as(app, member)
      .patch('/api/users/me')
      .send({ color: 'pink' });
    expect(bad.status).toBe(400);
    expect(bad.body.errorCode).toBe('VALIDATION_ERROR');
    const [log] = await audit('user.profile_updated');
    expect(log).toMatchObject({
      actorId: member.id,
      meta: { fields: ['color'] },
    });
  });

  it('чужий колір: модератор — ні, адмін — так (і модератору), з аудитом', async () => {
    const refused = await as(app, mod)
      .patch(`/api/users/${member.id}`)
      .send({ color: 'red' });
    expect(refused.status).toBe(403);
    await as(app, admin)
      .patch(`/api/users/${member.id}`)
      .send({ color: 'red' })
      .expect(200);
    await as(app, admin)
      .patch(`/api/users/${mod.id}`)
      .send({ color: 'gray' })
      .expect(200);
    expect(
      (await as(app, member).get(`/api/users/${member.id}`).expect(200)).body
        .color,
    ).toBe('red');
    const logs = await audit('user.updated');
    expect(
      logs.map((l) => [
        l.actorId,
        l.entityId,
        (l.meta as { fields: string[] }).fields,
      ]),
    ).toEqual([
      [admin.id, member.id, ['color']],
      [admin.id, mod.id, ['color']],
    ]);
  });

  it('колір іде з людиною: команда, виконавці ТЗ, рейтинг', async () => {
    const team = (await as(app, member).get('/api/users').expect(200)).body as
      | { items?: { id: string; color: string }[] }
      | { id: string; color: string }[];
    const list = Array.isArray(team) ? team : (team.items ?? []);
    expect(list.find((u) => u.id === member.id)?.color).toBe('teal');

    const task = await makeTask(app, mod);
    await as(app, member).post(`/api/tasks/${task.id}/take`).expect(200);
    const detail = (
      await as(app, member).get(`/api/tasks/${task.id}`).expect(200)
    ).body as { assignees: { id: string; color: string }[] };
    expect(detail.assignees[0]).toMatchObject({ id: member.id, color: 'teal' });

    const rating = (
      await as(app, member).get('/api/points/leaderboard').expect(200)
    ).body as unknown;
    expect(JSON.stringify(rating)).toContain('"color":"teal"');
  });
});
