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
  type TestUser,
} from './helpers';

// Гість: розваги, рейтинг, огляд ТЗ і проєктів — без їхніх карток; у команді
// (список людей, рейтинг, вибір людей) його немає.

describe('Гість (e2e)', () => {
  let app: INestApplication<App>;
  let mod: TestUser;
  let member: TestUser;
  let guest: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    guest = await makeUser(app, Role.Guest, { name: 'Гість Тест' });
  });

  it('модератор створює гостя (в аудиті з роллю), учасник — ні', async () => {
    const body = {
      email: 'g@test.local',
      name: 'Новий гість',
      password: 'password-123',
      role: 'guest',
    };
    await as(app, member).post('/api/users').send(body).expect(403);
    const r = await as(app, mod).post('/api/users').send(body).expect(201);
    expect(r.body.role).toBe('guest');
    const log = await app
      .get(DataSource)
      .getRepository(AuditLog)
      .findOneByOrFail({ action: 'user.created', entityId: r.body.id });
    expect(log.meta).toMatchObject({ role: 'guest' });
    await as(app, mod)
      .post('/api/users')
      .send({ ...body, email: 'x@test.local', role: 'moderator' })
      .expect(400);
  });

  it('модератор переводить гостя в учасники й назад; модератора в гості — ні', async () => {
    await as(app, mod)
      .patch(`/api/users/${guest.id}`)
      .send({ role: 'member' })
      .expect(200);
    await as(app, mod)
      .patch(`/api/users/${member.id}`)
      .send({ role: 'guest' })
      .expect(200);
    const mod2 = await makeUser(app, Role.Moderator);
    await as(app, mod)
      .patch(`/api/users/${mod2.id}`)
      .send({ role: 'guest' })
      .expect(403);
  });

  it('огляд ТЗ: де яке й хто виконує, без опису; картка ТЗ — 403', async () => {
    const t = await makeTask(app, mod, {
      title: 'Відео про лабораторію',
      description: 'Секретний опис',
    });
    const list = await as(app, guest).get('/api/tasks/overview').expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: t.id,
        title: 'Відео про лабораторію',
        status: 'todo',
        points: 10,
        assignees: [],
        type: null,
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain('Секретний опис');
    await as(app, guest).get('/api/tasks').expect(403);
    await as(app, guest).get(`/api/tasks/${t.id}`).expect(403);
    await as(app, guest).get('/api/tasks/archive').expect(403);
  });

  it('огляд проєктів без опису; картка, історія — 403; гостя не беруть в учасники', async () => {
    const p = await as(app, mod)
      .post('/api/projects')
      .send({
        title: 'Фестиваль',
        description: 'Бюджет і контакти',
        memberIds: [member.id],
      })
      .expect(201);
    const list = await as(app, guest).get('/api/projects/overview').expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({
        id: p.body.id,
        title: 'Фестиваль',

        members: [expect.objectContaining({ id: member.id })],
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain('Бюджет');
    await as(app, guest).get('/api/projects').expect(403);
    await as(app, guest).get(`/api/projects/${p.body.id}`).expect(403);
    await as(app, guest).get(`/api/projects/${p.body.id}/history`).expect(403);
    const r = await as(app, mod)
      .patch(`/api/projects/${p.body.id}`)
      .send({ memberIds: [guest.id] })
      .expect(400);
    expect(r.body.errorCode).toBe('UNKNOWN_MEMBER');
  });

  it('рейтинг бачить, але в ньому його немає; своїх балів і команди — ні', async () => {
    const r = await as(app, guest).get('/api/points/leaderboard').expect(200);
    const ids = (r.body as { userId?: string; id?: string }[]).map(
      (x) => x.userId ?? x.id,
    );
    expect(ids).toContain(member.id);
    expect(ids).not.toContain(guest.id);
    await as(app, guest).get('/api/points/me').expect(403);
    await as(app, guest).get('/api/users').expect(403);
    await as(app, guest).get(`/api/users/${member.id}`).expect(403);
  });

  it('у списку людей гостя немає; модератор бачить гостей, коли просить', async () => {
    const team = await as(app, member).get('/api/users?limit=100').expect(200);
    expect(team.body.items.map((u: { id: string }) => u.id)).not.toContain(
      guest.id,
    );
    await as(app, member).get(`/api/users/${guest.id}`).expect(404);
    const staff = await as(app, mod).get('/api/users?limit=100').expect(200);
    expect(staff.body.items.map((u: { id: string }) => u.id)).not.toContain(
      guest.id,
    );
    const all = await as(app, mod)
      .get('/api/users?limit=100&guests=true')
      .expect(200);
    expect(all.body.items.map((u: { id: string }) => u.id)).toContain(guest.id);
  });

  it('розваги: грає й робить свої карти; свій профіль', async () => {
    await as(app, guest).get('/api/bunker/rooms').expect(200);
    await as(app, guest)
      .post('/api/bunker/cards')
      .send({ kind: 'hobby', text: 'Шахи' })
      .expect(201);
    const me = await as(app, guest)
      .patch('/api/users/me')
      .send({ color: 'green' })
      .expect(200);
    expect(me.body).toMatchObject({ role: 'guest', color: 'green' });
    expect(me.body.permissions).toContain('bunker.play');
    expect(me.body.permissions).not.toContain('tasks.read');
  });

  it('решта закрита: обладнання, склад, архів, документи, лабораторія', async () => {
    for (const url of [
      '/api/places',
      '/api/inventory/items',
      '/api/archive',
      '/api/papers',
      '/api/smart/entities',
      '/api/dictionaries',
    ]) {
      const r = await as(app, guest).get(url);
      expect([url, r.status]).toEqual([url, 403]);
    }
  });
});
