import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeTask,
  makeUser,
  publishTaskPaper,
  resetDb,
  taskTemplates,
  taskTypes,
  TestUser,
} from './helpers';

// Типи ТЗ (6.3): довідник «Тип технічного завдання», обов'язкове поле «Тип»,
// версії 2 шаблонів ТЗ із ним; старі ТЗ — «Інше».

type Field = { key: string; required: boolean; dictionary: string | null };

describe('Типи ТЗ (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let mod: TestUser;
  let member: TestUser;
  let templates: { full: string; short: string };

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    templates = await taskTemplates(app);
  });

  it("довідник: шість типів із кольорами по порядку; поле «Тип» обов'язкове", async () => {
    await taskTypes(app);
    const dict = (
      await as(app, member).get('/api/dictionaries/task_type').expect(200)
    ).body as {
      title: string;
      items: { key: string; title: string; color: string }[];
    };
    expect(dict.title).toBe('Тип технічного завдання');
    expect(dict.items.map((i) => [i.title, i.color])).toEqual([
      ['Програмування', 'blue'],
      ['Дизайн', 'purple'],
      ['SMM', 'orange'],
      ['Відео', 'teal'],
      ['3D-друк', 'green'],
      ['Інше', 'gray'],
    ]);
    const schema = (
      await as(app, member).get('/api/records/task/schema').expect(200)
    ).body as {
      fields: {
        key: string;
        type: string;
        required?: boolean;
        dictionary?: string;
      }[];
    };
    expect(schema.fields.find((f) => f.key === 'type')).toMatchObject({
      type: 'enum',
      required: true,
      dictionary: 'task_type',
    });
  });

  it('старі ТЗ отримують «Інше»', async () => {
    const old = await makeTask(app, mod);
    await taskTypes(app);
    const task = (await as(app, member).get(`/api/tasks/${old.id}`).expect(200))
      .body as { extra: Record<string, unknown> };
    expect(task.extra).toEqual({ type: 'inshe' });
  });

  it('обидва шаблони — версія 2 з «Типом» після назви; поле знає свій довідник', async () => {
    await taskTypes(app);
    const list = (await as(app, mod).get('/api/papers/templates').expect(200))
      .body as {
      title: string;
      currentVersion: number;
      needsUpdate: boolean;
    }[];
    expect(list.map((t) => [t.title, t.currentVersion, t.needsUpdate])).toEqual(
      [
        ['Коротке ТЗ', 2, false],
        ['Технічне завдання', 2, false],
      ],
    );
    const p = (
      await as(app, mod)
        .post('/api/papers')
        .send({ templateId: templates.full })
        .expect(201)
    ).body as { template: { fields: Field[] } };
    const keys = p.template.fields.map((f) => f.key);
    expect(keys.slice(0, 2)).toEqual(['title', 'type']);
    expect(p.template.fields[1]).toMatchObject({
      required: true,
      dictionary: 'task_type',
    });
    expect(p.template.fields[0].dictionary).toBeNull();
  });

  it('без типу ТЗ не публікується; з типом — тип у ТЗ', async () => {
    await taskTypes(app);
    const bare = await publishTaskPaper(app, mod, templates.short);
    expect(bare.status).toBe(400);
    expect(bare.body).toMatchObject({
      errorCode: 'PAPER_REQUIRED_MISSING',
      field: 'type',
    });
    const ok = await publishTaskPaper(app, mod, templates.short, {
      title: 'Відеоролик',
      points: 10,
      type: 'video',
    });
    expect(ok.status).toBe(200);
    const task = (
      await as(app, member).get(`/api/tasks/${ok.body.targetId}`).expect(200)
    ).body as { extra: Record<string, unknown> };
    expect(task.extra).toEqual({ type: 'video' });
  });

  it('чернетка на версії 1 потребує оновлення шаблону — 409 TEMPLATE_NEEDS_UPDATE', async () => {
    const draft = (
      await as(app, mod)
        .post('/api/papers')
        .send({ templateId: templates.short })
        .expect(201)
    ).body as { id: string; revision: number };
    await as(app, mod)
      .patch(`/api/papers/${draft.id}`)
      .send({ revision: draft.revision, values: { title: 'ТЗ', points: 10 } })
      .expect(200);
    await taskTypes(app);
    const res = await as(app, mod).post(`/api/papers/${draft.id}/publish`);
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('TEMPLATE_NEEDS_UPDATE');
  });

  it('шаблон зі зміненою версією або чернеткою міграція не чіпає — він потребує оновлення', async () => {
    await as(app, mod)
      .post(`/api/papers/templates/${templates.short}/versions`)
      .expect(201);
    await taskTypes(app);
    const list = (await as(app, mod).get('/api/papers/templates').expect(200))
      .body as {
      title: string;
      currentVersion: number;
      needsUpdate: boolean;
    }[];
    expect(list.map((t) => [t.title, t.currentVersion, t.needsUpdate])).toEqual(
      [
        ['Коротке ТЗ', 1, true],
        ['Технічне завдання', 2, false],
      ],
    );
  });

  it('повторний запуск (setup) нічого не змінює', async () => {
    await taskTypes(app);
    const q = ds.createQueryRunner();
    const { TaskTypeTemplates1826000000000 } =
      await import('../src/migrations/1826000000000-TaskTypeTemplates');
    try {
      await new TaskTypeTemplates1826000000000().up(q);
    } finally {
      await q.release();
    }
    const [{ n }] = await ds.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM paper_template_versions`,
    );
    expect(n).toBe(4);
  });
});
