import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

type Entry = {
  id: string;
  action: string;
  actor: { id: string; name: string } | null;
  createdAt: string;
};

describe('Журнал дій (e2e)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let mod: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator, { name: 'Олег' });
    const repo = app.get(DataSource).getRepository(AuditLog);
    // Same timestamp for several rows: the cursor must not skip or repeat.
    const at = new Date('2026-11-01T10:00:00.123456Z');
    await repo.query('DELETE FROM audit_log');
    for (let i = 0; i < 5; i++) {
      await repo.query(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, created_at)
         VALUES ($1, $2, 'user', NULL, $3)`,
        [mod.id, i % 2 ? 'user.updated' : 'points.awarded', at],
      );
    }
    await repo.query(
      `INSERT INTO audit_log (actor_id, action, entity, created_at)
       VALUES (NULL, 'session.auto_closed', 'session', now())`,
    );
  });

  const list = async (query: string) => {
    const res = await as(app, admin).get(`/api/audit${query}`);
    expect(res.status).toBe(200);
    return res.body as Entry[];
  };

  it('нові спершу, з іменем автора; дії сервера — без автора', async () => {
    const all = await list('');
    expect(all).toHaveLength(6);
    expect(all[0]).toMatchObject({
      action: 'session.auto_closed',
      actor: null,
    });
    expect(all[1]!.actor).toEqual({ id: mod.id, name: 'Олег' });
  });

  it('сторінки через before без пропусків і повторів', async () => {
    const seen: string[] = [];
    let before = '';
    for (;;) {
      const page = await list(`?limit=2${before ? `&before=${before}` : ''}`);
      if (!page.length) break;
      seen.push(...page.map((e) => e.id));
      before = page[page.length - 1]!.id;
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(seen).toEqual((await list('')).map((e) => e.id));
  });

  it('фільтри: група дій, точна дія, автор, об’єкт', async () => {
    expect(await list('?action=user.')).toHaveLength(2);
    expect(await list('?action=points.awarded')).toHaveLength(3);
    expect(await list('?action=points.')).toHaveLength(3);
    expect(await list(`?actorId=${mod.id}`)).toHaveLength(5);
    expect(await list('?entity=session')).toHaveLength(1);
    // «_» is not a wildcard in a group: unescaped, «use_.» would match «user.».
    expect(await list('?action=use_.')).toHaveLength(0);
  });

  it('невідомий курсор before — 404 з кодом, а не порожній кінець журналу', async () => {
    const res = await as(app, admin).get(
      '/api/audit?before=00000000-0000-4000-8000-000000000000',
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ errorCode: 'AUDIT_CURSOR_NOT_FOUND' });
  });

  it('невірні параметри — 400', async () => {
    const res = await as(app, admin).get('/api/audit?action=user%27--');
    expect(res.status).toBe(400);
    expect((await as(app, admin).get('/api/audit?before=x')).status).toBe(400);
  });

  it('модератору закрито', async () => {
    expect((await as(app, mod).get('/api/audit')).status).toBe(403);
  });
});
