import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { TASK_LINKS } from '../src/tasks/task.links';
import { AUTO_ARCHIVE_DAYS, TasksService } from '../src/tasks/tasks.service';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeTask,
  makeUser,
  resetDb,
  TestUser,
} from './helpers';

// Архів ТЗ: у архів — лише виконане (staff), «Усі виконані — в архів»,
// повернення, автоматичне перенесення через 30 днів, дошка без архівних,
// список архіву з пошуком, роком, полем-довідником і сторінками, аудит.

type Res = { status: number; body: Record<string, any> };

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

const DAY = 86_400_000;

describe('Архів ТЗ (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let a: TestUser;

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
  });

  const act = (u: TestUser, id: string, step: string, body?: object) =>
    as(app, u)
      .post(`/api/tasks/${id}/${step}`)
      .send(body ?? {});
  const finish = async (title = 'Зняти відео') => {
    const id = (await makeTask(app, mod, { title, maxAssignees: 1 })).id;
    await act(a, id, 'take').expect(200);
    await act(a, id, 'start').expect(200);
    await act(a, id, 'submit').expect(200);
    await act(mod, id, 'accept').expect(200);
    return id;
  };
  const board = async () =>
    (await as(app, a).get('/api/tasks').expect(200)).body.map(
      (t: { id: string }) => t.id,
    );
  const audit = (id: string) =>
    ds.query<{ action: string; actor_id: string | null; meta: any }[]>(
      `SELECT action, actor_id, meta FROM audit_log
       WHERE entity = 'task' AND entity_id = $1 AND action LIKE 'task.%archived'
       ORDER BY created_at, id`,
      [id],
    );

  it('в архів — лише виконане й лише staff; дошка архівних не показує', async () => {
    const free = (await makeTask(app, mod, { title: 'Вільне' })).id;
    const done = await finish();

    code(await act(mod, free, 'archive'), 409, 'TASK_NOT_DONE');
    code(await act(a, done, 'archive'), 403, 'FORBIDDEN');

    const res = await act(mod, done, 'archive').expect(200);
    expect(res.body.archivedById).toBe(mod.id);
    expect(res.body.archivedAt).toEqual(expect.any(String));
    code(await act(admin, done, 'archive'), 409, 'TASK_ARCHIVED');

    expect(await board()).toEqual([free]);
    expect(
      (await as(app, a).get('/api/tasks?status=done').expect(200)).body,
    ).toEqual([]);
    // The task itself is still there for everyone, with its points.
    const one = await as(app, a).get(`/api/tasks/${done}`).expect(200);
    expect(one.body.archivedAt).toEqual(expect.any(String));
    const [{ n }] = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM points_ledger WHERE task_id = $1`,
      [done],
    );
    expect(n).toBe(1);
    // Links show it as archived.
    const links = await TASK_LINKS.find([done, free], a, ds.manager);
    expect(links.get(done)?.archived).toBe(true);
    expect(links.get(free)?.archived).toBe(false);

    expect(await audit(done)).toEqual([
      { action: 'task.archived', actor_id: mod.id, meta: {} },
    ]);
  });

  it('повернення з архіву: staff, лише архівне; аудит', async () => {
    const done = await finish();
    code(await act(mod, done, 'unarchive'), 409, 'TASK_NOT_ARCHIVED');
    await act(mod, done, 'archive').expect(200);
    code(await act(a, done, 'unarchive'), 403, 'FORBIDDEN');

    const res = await act(admin, done, 'unarchive').expect(200);
    expect(res.body).toMatchObject({ archivedAt: null, archivedById: null });
    expect(await board()).toEqual([done]);
    expect((await audit(done)).map((r) => [r.action, r.actor_id])).toEqual([
      ['task.archived', mod.id],
      ['task.unarchived', admin.id],
    ]);
  });

  it('«Усі виконані — в архів»: лише виконані з дошки, по запису аудиту на кожне', async () => {
    const one = await finish('Одне');
    const two = await finish('Друге');
    const free = (await makeTask(app, mod, { title: 'Вільне' })).id;
    await act(mod, one, 'archive').expect(200);

    await as(app, a).post('/api/tasks/archive-done').expect(403);
    const res = await as(app, mod).post('/api/tasks/archive-done').expect(200);
    expect(res.body).toEqual({ count: 1 });
    expect(await board()).toEqual([free]);
    expect(await audit(two)).toEqual([
      { action: 'task.archived', actor_id: mod.id, meta: { all: true } },
    ]);
    expect(
      (await as(app, mod).post('/api/tasks/archive-done').expect(200)).body,
    ).toEqual({ count: 0 });
  });

  it('автоматично: через 30 днів після прийняття або повернення, без людини в аудиті', async () => {
    const old = await finish('Давнє');
    const fresh = await finish('Свіже');
    const returned = await finish('Повернуте');
    const tasks = app.get(TasksService);
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    await ds.query(`UPDATE tasks SET completed_at = $2 WHERE id = ANY($1)`, [
      [old, returned],
      ago(AUTO_ARCHIVE_DAYS + 1),
    ]);
    await act(mod, returned, 'archive').expect(200);
    await act(mod, returned, 'unarchive').expect(200);

    expect(await tasks.autoArchive(now)).toBe(1);
    expect(await board()).toEqual(expect.arrayContaining([fresh, returned]));
    expect(await board()).not.toContain(old);
    const [row] = await audit(old);
    expect(row).toEqual({
      action: 'task.archived',
      actor_id: null,
      meta: { auto: true, days: AUTO_ARCHIVE_DAYS },
    });
    const view = await as(app, a).get(`/api/tasks/${old}`).expect(200);
    expect(view.body.archivedById).toBeNull();

    // Returned 31 days ago — goes again; a fresh one stays.
    await ds.query(`UPDATE tasks SET unarchived_at = $2 WHERE id = $1`, [
      returned,
      ago(AUTO_ARCHIVE_DAYS + 1),
    ]);
    expect(await tasks.autoArchive(now)).toBe(1);
    expect(await board()).toEqual([fresh]);
    expect(await tasks.autoArchive(now)).toBe(0);
  });

  it('список архіву: пошук, рік, поле-довідник, сторінки; бачить кожен', async () => {
    const t1 = await finish('Відео про лабораторію');
    const t2 = await finish('Логотип');
    const t3 = await finish('Відео для SMM');
    await finish('Ще на дошці');
    await ds.query(
      `UPDATE tasks SET extra = '{"type":"video"}' WHERE id = $1`,
      [t1],
    );
    await ds.query(
      `UPDATE tasks SET extra = '{"type":"dyzain","tags":["a","b"]}' WHERE id = $1`,
      [t2],
    );
    await ds.query(
      `UPDATE tasks SET extra = '{"type":"video","tags":["b"]}', completed_at = '2025-05-01' WHERE id = $1`,
      [t3],
    );
    for (const id of [t1, t2, t3]) await act(mod, id, 'archive').expect(200);

    const get = async (query: string) =>
      (await as(app, a).get(`/api/tasks/archive${query}`).expect(200)).body;
    const ids = (body: { items: { id: string }[] }) =>
      body.items.map((t) => t.id);

    const all = await get('');
    expect(all.total).toBe(3);
    expect(all.items[0].assignees).toHaveLength(1);
    expect(all.years).toEqual([now().getFullYear(), 2025]);
    // Newest accepted first.
    expect(ids(all).at(-1)).toBe(t3);

    expect(ids(await get('?search=%D0%B2%D1%96%D0%B4%D0%B5%D0%BE'))).toEqual(
      expect.arrayContaining([t1, t3]),
    );
    expect((await get('?search=відео')).total).toBe(2);
    expect(ids(await get('?year=2025'))).toEqual([t3]);
    expect(ids(await get('?field=type:dyzain'))).toEqual([t2]);
    expect((await get('?field=tags:b')).total).toBe(2);
    expect(ids(await get('?field=tags:b&field=type:video'))).toEqual([t3]);
    expect((await get('?field=type:nema')).total).toBe(0);

    const p1 = await get('?limit=2');
    const p2 = await get('?limit=2&page=2');
    expect(p1).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect([...ids(p1), ...ids(p2)].sort()).toEqual([t1, t2, t3].sort());

    await as(app, a).get('/api/tasks/archive?field=type').expect(400);
    await as(app, a).get("/api/tasks/archive?field=type:x'y").expect(400);
    await as(app, a).get('/api/tasks/archive?year=25').expect(400);
  });
});

const now = () => new Date();
