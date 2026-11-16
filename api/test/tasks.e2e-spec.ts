import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeTask,
  makeUser,
  PNG_1PX,
  resetDb,
  TestUser,
} from './helpers';

// Увесь шлях ТЗ: Вільне → В черзі → В роботі → На перевірці → Виконано,
// повернення на допрацювання, ліміт виконавців, поділ балів, коментарі, файли,
// скасування з причиною. Створюють і змінюють ТЗ документи (paper-publish,
// paper-change, task-papers); тут ТЗ створює сервіс, як адаптер документа.

type Res = { status: number; body: Record<string, any> };

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

describe('ТЗ (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let mod: TestUser;
  let mod2: TestUser;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    mod = await makeUser(app, Role.Moderator);
    mod2 = await makeUser(app, Role.Moderator);
    a = await makeUser(app, Role.Member);
    b = await makeUser(app, Role.Member);
    c = await makeUser(app, Role.Member);
  });

  const create = async (over: Record<string, unknown> = {}) =>
    (
      await makeTask(app, mod, {
        title: 'Зняти відео',
        points: 10,
        maxAssignees: 3,
        ...over,
      })
    ).id;
  const act = (u: TestUser, id: string, step: string, body?: object) =>
    as(app, u)
      .post(`/api/tasks/${id}/${step}`)
      .send(body ?? {});
  const ledger = async (taskId: string) =>
    (
      await ds.query<{ user_id: string; amount: number; kind: string }[]>(
        `SELECT user_id, amount, kind::text FROM points_ledger WHERE task_id = $1`,
        [taskId],
      )
    ).reduce<Record<string, number>>((acc, r) => {
      expect(r.kind).toBe('task');
      acc[r.user_id] = r.amount;
      return acc;
    }, {});

  it('виконані: останні виконані першими, limit обмежує кількість', async () => {
    const finish = async (title: string) => {
      const id = await create({ title, maxAssignees: 1 });
      await act(a, id, 'take').expect(200);
      await act(a, id, 'start').expect(200);
      await act(a, id, 'submit').expect(200);
      await act(mod, id, 'accept').expect(200);
      return id;
    };
    const first = await finish('Перше');
    const second = await finish('Друге');
    // The older task is completed last, so it must come first.
    await ds.query(
      `UPDATE tasks SET completed_at = (SELECT max(completed_at) FROM tasks) + interval '1 minute' WHERE id = $1`,
      [first],
    );
    await create({ title: 'Вільне' });

    const done = await as(app, b).get('/api/tasks?status=done').expect(200);
    expect(done.body.map((t: { id: string }) => t.id)).toEqual([first, second]);
    const one = await as(app, b)
      .get('/api/tasks?status=done&limit=1')
      .expect(200);
    expect(one.body.map((t: { id: string }) => t.id)).toEqual([first]);
    // Assignees still come with a limited list.
    expect(one.body[0].assignees).toHaveLength(1);
    const all = await as(app, b).get('/api/tasks?limit=2').expect(200);
    expect(all.body).toHaveLength(2);
    await as(app, b).get('/api/tasks?limit=abc').expect(400);
  });

  it('повний шлях з поверненням і поділом 10 балів на трьох', async () => {
    const id = await create();
    const fresh = await as(app, a).get(`/api/tasks/${id}`);
    expect(fresh.body).toMatchObject({
      status: 'todo',
      maxAssignees: 3,
      assignees: [],
      comments: [],
      files: [],
    });

    // Беруть по одному: ТЗ лишається вільним, навіть коли місць більше немає.
    expect((await act(a, id, 'take')).body.status).toBe('todo');
    await new Promise((r) => setTimeout(r, 5));
    expect((await act(b, id, 'take')).body.status).toBe('todo');
    await new Promise((r) => setTimeout(r, 5));
    const third = await act(c, id, 'take');
    expect(third.body.status).toBe('todo');
    expect(third.body.assignees.map((x: { id: string }) => x.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);

    // Почали роботу: приєднатись уже не можна.
    expect((await act(b, id, 'start')).body.status).toBe('in_progress');
    code(await act(mod2, id, 'take'), 409, 'TASK_ALREADY_STARTED');

    // Здали, модератор повертає з коментарем.
    expect((await act(c, id, 'submit')).body.status).toBe('review');
    code(await act(mod, id, 'return'), 400, 'VALIDATION_ERROR');
    const back = await act(mod, id, 'return', { body: 'Звук тихий' });
    expect(back.body.status).toBe('in_progress');
    const detail = await as(app, a).get(`/api/tasks/${id}`);
    expect(detail.body.comments).toMatchObject([
      { kind: 'return', body: 'Звук тихий', author: { id: mod.id } },
    ]);
    expect(await ledger(id)).toEqual({});

    // Повторно здали і прийняли: 4 + 3 + 3, зайвий бал першому.
    await act(a, id, 'submit');
    const done = await act(mod2, id, 'accept');
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('done');
    expect(done.body.completedAt).toBeTruthy();
    expect(await ledger(id)).toEqual({ [a.id]: 4, [b.id]: 3, [c.id]: 3 });

    // Бали видно в профілі.
    const me = await as(app, a).get('/api/points/me');
    expect(me.body.balance).toBe(4);
    expect(me.body.history[0]).toMatchObject({
      kind: 'task',
      amount: 4,
      taskId: id,
      taskTitle: 'Зняти відео',
    });

    // Повторне прийняття і будь-які переходи після «Виконано» — ні.
    code(await act(mod, id, 'accept'), 409, 'TASK_ALREADY_COMPLETED');
    code(await act(a, id, 'leave'), 409, 'TASK_ALREADY_COMPLETED');
    code(
      await act(mod, id, 'cancel', { reason: 'x' }),
      409,
      'TASK_HAS_ASSIGNEES',
    );
    expect(await ledger(id)).toEqual({ [a.id]: 4, [b.id]: 3, [c.id]: 3 });

    // Усе в аудиті.
    const actions = (
      await ds.query<{ action: string }[]>(
        `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at`,
        [id],
      )
    ).map((r) => r.action);
    expect(actions).toEqual([
      'task.created',
      'task.taken',
      'task.taken',
      'task.taken',
      'task.started',
      'task.submitted',
      'task.returned',
      'task.submitted',
      'task.accepted',
    ]);
  });

  it('ліміт виконавців і повторне взяття', async () => {
    const id = await create({ maxAssignees: 2 });
    await act(a, id, 'take');
    code(await act(a, id, 'take'), 409, 'TASK_ALREADY_TAKEN');
    await act(b, id, 'take');
    code(await act(c, id, 'take'), 409, 'TASK_FULL');
  });

  it('«взяти й почати» — лише останнім місцем', async () => {
    const id = await create({ maxAssignees: 2 });
    code(await act(a, id, 'take', { start: true }), 409, 'TASK_SLOTS_LEFT');
    expect((await as(app, a).get(`/api/tasks/${id}`)).body).toMatchObject({
      status: 'todo',
      assignees: [],
    });
    await act(a, id, 'take').expect(200);
    const res = await act(b, id, 'take', { start: true }).expect(200);
    expect(res.body.status).toBe('in_progress');
    expect(res.body.assignees.map((x: { id: string }) => x.id)).toEqual([
      a.id,
      b.id,
    ]);
    code(await act(c, id, 'take'), 409, 'TASK_ALREADY_STARTED');
    await act(c, id, 'take', { start: 'yes' }).expect(400);
    const actions = (
      await ds.query<{ action: string; meta: { to: string } }[]>(
        `SELECT action, meta FROM audit_log WHERE entity_id = $1 ORDER BY created_at, action DESC`,
        [id],
      )
    ).map((r) => `${r.action}:${r.meta?.to ?? ''}`);
    expect(actions).toEqual([
      'task.created:',
      'task.taken:todo',
      'task.taken:todo',
      'task.started:in_progress',
    ]);
  });

  it('одночасні запити не перевищують ліміт', async () => {
    const id = await create({ maxAssignees: 1 });
    const res = await Promise.all([a, b, c].map((u) => act(u, id, 'take')));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.body.errorCode === 'TASK_FULL')).toHaveLength(2);
  });

  it('одночасне прийняття нараховує бали один раз', async () => {
    const id = await create({ points: 9, maxAssignees: 1 });
    for (const s of ['take', 'start', 'submit']) await act(a, id, s);
    const res = await Promise.all([
      act(mod, id, 'accept'),
      act(mod2, id, 'accept'),
    ]);
    expect(res.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 409]);
    expect(await ledger(id)).toEqual({ [a.id]: 9 });
  });

  it('відмова: останній звільняє ТЗ', async () => {
    const id = await create();
    await act(a, id, 'take');
    await act(b, id, 'take');
    expect((await act(a, id, 'leave')).body.status).toBe('todo');
    expect((await act(b, id, 'leave')).body).toMatchObject({
      status: 'todo',
      assignees: [],
    });
    await act(b, id, 'take');
    await act(b, id, 'start');
    const left = await act(b, id, 'leave');
    expect(left.body).toMatchObject({ status: 'todo', assignees: [] });
    code(await act(b, id, 'leave'), 403, 'NOT_PARTICIPANT');
  });

  it('недозволені переходи', async () => {
    const id = await create();
    code(await act(a, id, 'start'), 403, 'NOT_PARTICIPANT');
    await act(a, id, 'take');
    code(await act(a, id, 'submit'), 409, 'TASK_INVALID_TRANSITION');
    code(await act(mod, id, 'accept'), 409, 'TASK_INVALID_TRANSITION');
    await act(a, id, 'start');
    code(await act(a, id, 'start'), 409, 'TASK_INVALID_TRANSITION');
    code(
      await act(mod, id, 'return', { body: 'x' }),
      409,
      'TASK_INVALID_TRANSITION',
    );
    await act(a, id, 'submit');
    code(await act(a, id, 'leave'), 409, 'TASK_INVALID_TRANSITION');
  });

  it('0 балів: прийняття без записів у книзі', async () => {
    const id = await create({ points: 0 });
    for (const s of ['take', 'start', 'submit']) await act(a, id, s);
    expect((await act(mod, id, 'accept')).status).toBe(200);
    expect(await ledger(id)).toEqual({});
  });

  it('модератор-виконавець не приймає своє, інший модератор приймає', async () => {
    const id = await create({ maxAssignees: 2 });
    await act(mod, id, 'take');
    await act(a, id, 'take');
    for (const s of ['start', 'submit']) await act(a, id, s);
    code(await act(mod, id, 'accept'), 403, 'SELF_ACTION_FORBIDDEN');
    expect((await act(mod2, id, 'accept')).status).toBe(200);
    expect(await ledger(id)).toEqual({ [mod.id]: 5, [a.id]: 5 });
  });

  it('скасування з причиною: лише вільне без виконавців, лише модератор', async () => {
    const id = await create();
    await act(a, id, 'take');
    code(
      await act(mod, id, 'cancel', { reason: 'Не потрібно' }),
      409,
      'TASK_HAS_ASSIGNEES',
    );

    const free = await create();
    expect((await act(a, free, 'cancel', { reason: 'x' })).status).toBe(403);
    code(
      await act(mod, free, 'cancel', { reason: ' ' }),
      400,
      'VALIDATION_ERROR',
    );
    expect(
      (await act(mod, free, 'cancel', { reason: 'Не потрібно' })).status,
    ).toBe(200);
    expect((await as(app, a).get(`/api/tasks/${free}`)).status).toBe(404);
    const [log] = await ds.query<{ meta: Record<string, unknown> }[]>(
      `SELECT meta FROM audit_log WHERE action = 'task.deleted' AND entity_id = $1`,
      [free],
    );
    expect(log.meta).toMatchObject({
      title: 'Зняти відео',
      reason: 'Не потрібно',
    });
  });

  it('фільтри дошки: статус і «мої»', async () => {
    const t1 = await create();
    const t2 = await create();
    await act(a, t1, 'take');
    const mine = await as(app, a).get('/api/tasks?mine=true');
    expect(mine.body.map((t: { id: string }) => t.id)).toEqual([t1]);
    // Узяте, але не почате ТЗ лишається вільним.
    const free = await as(app, a).get('/api/tasks?status=todo');
    expect(free.body.map((t: { id: string }) => t.id).sort()).toEqual(
      [t1, t2].sort(),
    );
    expect((await as(app, a).get('/api/tasks?status=bad')).status).toBe(400);
  });

  it('коментарі: пише будь-хто, порожній не можна', async () => {
    const id = await create();
    const res = await as(app, c)
      .post(`/api/tasks/${id}/comments`)
      .send({ body: ' Коли дедлайн? ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'comment',
      body: 'Коли дедлайн?',
      author: { id: c.id, name: c.name },
    });
    code(
      await as(app, c).post(`/api/tasks/${id}/comments`).send({ body: '  ' }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('файли: виконавці й модератори додають, видаляє автор або модератор', async () => {
    const id = await create();
    const upload = (u: TestUser) =>
      as(app, u)
        .post(`/api/tasks/${id}/files`)
        .attach('file', PNG_1PX, 'кадр.png');

    code(await upload(a), 403, 'NOT_PARTICIPANT');
    await act(a, id, 'take');
    const f = await upload(a);
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({
      fileName: 'кадр.png',
      mimeType: 'image/png',
    });
    expect((await upload(mod)).status).toBe(201);

    const dl = await as(app, b).get(
      `/api/tasks/${id}/files/${f.body.id}/download`,
    );
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');

    expect(
      (await as(app, b).delete(`/api/tasks/${id}/files/${f.body.id}`)).status,
    ).toBe(403);
    expect(
      (await as(app, a).delete(`/api/tasks/${id}/files/${f.body.id}`)).status,
    ).toBe(200);
    const detail = await as(app, a).get(`/api/tasks/${id}`);
    expect(detail.body.files).toHaveLength(1);
  });

  it('старі ендпоінти прибрано: ТЗ створюють і змінюють лише документи', async () => {
    const id = await create();
    const gone = [
      await as(app, mod)
        .patch(`/api/tasks/${id}/status`)
        .send({ status: 'done' }),
      await as(app, mod).post('/api/tasks').send({ title: 'x', points: 1 }),
      await as(app, mod).patch(`/api/tasks/${id}`).send({ title: 'x' }),
      await as(app, mod).delete(`/api/tasks/${id}`),
    ];
    expect(gone.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect((await as(app, a).get(`/api/tasks/${id}`)).body).toMatchObject({
      title: 'Зняти відео',
      paper: null,
    });
  });
});
