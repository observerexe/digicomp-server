import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  PNG_1PX,
  resetDb,
  TestUser,
} from './helpers';

// Увесь шлях ТЗ: Вільне → В черзі → В роботі → На перевірці → Виконано,
// повернення на допрацювання, ліміт виконавців, поділ балів, коментарі, файли.

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

  const create = async (over: Record<string, unknown> = {}) => {
    const res = await as(app, mod)
      .post('/tasks')
      .send({ title: 'Зняти відео', points: 10, maxAssignees: 3, ...over });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const act = (u: TestUser, id: string, step: string, body?: object) =>
    as(app, u)
      .post(`/tasks/${id}/${step}`)
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

  it('повний шлях з поверненням і поділом 10 балів на трьох', async () => {
    const id = await create();
    const fresh = await as(app, a).get(`/tasks/${id}`);
    expect(fresh.body).toMatchObject({
      status: 'todo',
      maxAssignees: 3,
      assignees: [],
      comments: [],
      files: [],
    });

    // Перший бере: ТЗ стає «в черзі», інші приєднуються.
    expect((await act(a, id, 'take')).body.status).toBe('queued');
    await new Promise((r) => setTimeout(r, 5));
    expect((await act(b, id, 'take')).body.status).toBe('queued');
    await new Promise((r) => setTimeout(r, 5));
    const third = await act(c, id, 'take');
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
    const detail = await as(app, a).get(`/tasks/${id}`);
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
    const me = await as(app, a).get('/points/me');
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
      await as(app, mod).patch(`/tasks/${id}`).send({ points: 50 }),
      409,
      'TASK_ALREADY_COMPLETED',
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
    expect((await act(a, id, 'leave')).body.status).toBe('queued');
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

  it('редагування і видалення', async () => {
    const id = await create({ maxAssignees: 3 });
    const upd = await as(app, mod)
      .patch(`/tasks/${id}`)
      .send({ title: 'Нова назва', dueDate: '2026-12-01T00:00:00.000Z' });
    expect(upd.body).toMatchObject({ title: 'Нова назва' });
    expect(new Date(upd.body.dueDate as string).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(
      (await as(app, mod).patch(`/tasks/${id}`).send({ dueDate: null })).body
        .dueDate,
    ).toBeNull();
    expect(
      (await as(app, a).patch(`/tasks/${id}`).send({ title: 'x' })).status,
    ).toBe(403);

    await act(a, id, 'take');
    await act(b, id, 'take');
    code(
      await as(app, mod).patch(`/tasks/${id}`).send({ maxAssignees: 1 }),
      409,
      'MAX_ASSIGNEES_TOO_LOW',
    );
    code(await as(app, mod).delete(`/tasks/${id}`), 409, 'TASK_HAS_ASSIGNEES');

    const free = await create();
    expect((await as(app, a).delete(`/tasks/${free}`)).status).toBe(403);
    expect((await as(app, mod).delete(`/tasks/${free}`)).status).toBe(200);
    expect((await as(app, a).get(`/tasks/${free}`)).status).toBe(404);
  });

  it('фільтри дошки: статус і «мої»', async () => {
    const t1 = await create();
    const t2 = await create();
    await act(a, t1, 'take');
    const mine = await as(app, a).get('/tasks?mine=true');
    expect(mine.body.map((t: { id: string }) => t.id)).toEqual([t1]);
    const free = await as(app, a).get('/tasks?status=todo');
    expect(free.body.map((t: { id: string }) => t.id)).toEqual([t2]);
    expect((await as(app, a).get('/tasks?status=bad')).status).toBe(400);
  });

  it('коментарі: пише будь-хто, порожній не можна', async () => {
    const id = await create();
    const res = await as(app, c)
      .post(`/tasks/${id}/comments`)
      .send({ body: ' Коли дедлайн? ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'comment',
      body: 'Коли дедлайн?',
      author: { id: c.id, name: c.name },
    });
    code(
      await as(app, c).post(`/tasks/${id}/comments`).send({ body: '  ' }),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('файли: виконавці й модератори додають, видаляє автор або модератор', async () => {
    const id = await create();
    const upload = (u: TestUser) =>
      as(app, u).post(`/tasks/${id}/files`).attach('file', PNG_1PX, 'кадр.png');

    code(await upload(a), 403, 'NOT_PARTICIPANT');
    await act(a, id, 'take');
    const f = await upload(a);
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({
      fileName: 'кадр.png',
      mimeType: 'image/png',
    });
    expect((await upload(mod)).status).toBe(201);

    const dl = await as(app, b).get(`/tasks/${id}/files/${f.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');

    expect(
      (await as(app, b).delete(`/tasks/${id}/files/${f.body.id}`)).status,
    ).toBe(403);
    expect(
      (await as(app, a).delete(`/tasks/${id}/files/${f.body.id}`)).status,
    ).toBe(200);
    const detail = await as(app, a).get(`/tasks/${id}`);
    expect(detail.body.files).toHaveLength(1);
  });

  it('старий PATCH /tasks/:id/status і assigneeIds прибрано', async () => {
    const id = await create();
    expect(
      (await as(app, mod).patch(`/tasks/${id}/status`).send({ status: 'done' }))
        .status,
    ).toBe(404);
    code(
      await as(app, mod)
        .post('/tasks')
        .send({ title: 'x', points: 1, assigneeIds: [a.id] }),
      400,
      'VALIDATION_ERROR',
    );
  });
});
