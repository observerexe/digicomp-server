import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { TaskTemplates1812000000000 } from '../src/migrations/1812000000000-TaskTemplates';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeTask,
  makeUser,
  resetDb,
  taskTemplates,
  TestUser,
} from './helpers';

// ТЗ через документ (3.1г): шаблони «Технічне завдання» й «Коротке ТЗ» з
// міграції, шлях ТЗ від документа до приймання, документ для старого ТЗ
// (`POST /papers/for-record`), номер документа в ТЗ.

type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Paper = {
  id: string;
  number: string | null;
  status: string;
  revision: number;
  content: Node;
  values: Record<string, unknown>;
  targetType: string | null;
  targetId: string | null;
  canChange: boolean;
};

const YEAR = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
}).format(new Date());

/** The doc with the zone `key` holding these lines. */
const withZone = (n: Node, key: string, text: string): Node =>
  n.type === 'fieldZone' && n.attrs?.key === key
    ? {
        ...n,
        content: text.split('\n').map((l) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: l }],
        })),
      }
    : n.content
      ? { ...n, content: n.content.map((c) => withZone(c, key, text)) }
      : n;

const zoneText = (n: Node, key: string): string | null => {
  if (n.type === 'fieldZone' && n.attrs?.key === key) {
    return (n.content ?? [])
      .map((p) => (p.content ?? []).map((t) => t.text).join(''))
      .join('\n');
  }
  for (const c of n.content ?? []) {
    const found = zoneText(c, key);
    if (found !== null) return found;
  }
  return null;
};

describe('ТЗ через документ (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let member2: TestUser;
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
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    member2 = await makeUser(app, Role.Member);
    templates = await taskTemplates(app);
  });

  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const audit = (action: string) =>
    ds.getRepository(AuditLog).findBy({ action });
  const forRecord = (u: TestUser, targetId: string, templateId?: string) =>
    as(app, u)
      .post('/api/papers/for-record')
      .send({ templateId: templateId ?? templates.full, targetId });

  describe('шаблони з міграції', () => {
    it('обидва створюють ТЗ: префікс ТЗ, модератори, видимі всім, автофіксація', async () => {
      const list = (await as(app, mod).get('/api/papers/templates').expect(200))
        .body as Record<string, unknown>[];
      expect(
        list.map((t) => [
          t.title,
          t.kind,
          t.target,
          t.numberPrefix,
          t.autoFreeze,
          t.creators,
          t.visibility,
          t.currentVersion,
          t.needsUpdate,
        ]),
      ).toEqual([
        [
          'Коротке ТЗ',
          'creates',
          'task',
          'ТЗ',
          true,
          'staff',
          'members',
          1,
          false,
        ],
        [
          'Технічне завдання',
          'creates',
          'task',
          'ТЗ',
          true,
          'staff',
          'members',
          1,
          false,
        ],
      ]);
      // Учасник документи з них не робить.
      expect(
        (await as(app, member).get('/api/papers/templates').expect(200)).body,
      ).toEqual([]);
    });

    it('без адміна нічого не створюється; повторно — не дублюються; відкат прибирає невикористані', async () => {
      const q = ds.createQueryRunner();
      const migration = new TaskTemplates1812000000000();
      const count = async () =>
        (
          await ds.query<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM paper_templates`,
          )
        )[0].n;
      try {
        await migration.up(q);
        expect(await count()).toBe(2);
        // Документ з «Короткого ТЗ» тримає його під час відкату.
        await as(app, mod)
          .post('/api/papers')
          .send({ templateId: templates.short })
          .expect(201);
        await migration.down(q);
        expect(await ds.query(`SELECT title FROM paper_templates`)).toEqual([
          { title: 'Коротке ТЗ' },
        ]);
        await ds.query(`UPDATE users SET active = false WHERE role = 'admin'`);
        await migration.up(q);
        expect(await count()).toBe(1);
      } finally {
        await q.release();
      }
    });
  });

  it('«Технічне завдання»: публікація створює ТЗ, далі документ показує виконавців і приймання', async () => {
    const draft = (
      await as(app, mod)
        .post('/api/papers')
        .send({ templateId: templates.full })
        .expect(201)
    ).body as Paper;
    let content = withZone(draft.content, 'goal', 'Безпечне місце для паяння');
    content = withZone(content, 'requirements', 'Стенд закріплено');
    await as(app, mod)
      .patch(`/api/papers/${draft.id}`)
      .send({
        revision: draft.revision,
        values: {
          title: 'Монтаж стенду',
          points: 12,
          maxAssignees: 2,
          dueDate: '2026-12-01T10:00:00.000Z',
        },
        content,
      })
      .expect(200);
    const published = (
      await as(app, mod).post(`/api/papers/${draft.id}/publish`).expect(200)
    ).body as Paper;
    expect(published.number).toBe(`ТЗ-${YEAR}-001`);
    const url = `/api/tasks/${published.targetId}`;
    const task = (await as(app, member).get(url).expect(200)).body;
    expect(task).toMatchObject({
      title: 'Монтаж стенду',
      description: 'Безпечне місце для паяння',
      points: 12,
      maxAssignees: 2,
      paper: { id: draft.id, number: `ТЗ-${YEAR}-001` },
    });

    for (const u of [member, member2]) {
      await as(app, u).post(`${url}/take`).expect(200);
    }
    await as(app, member).post(`${url}/start`).expect(200);
    await as(app, member).post(`${url}/submit`).expect(200);
    await as(app, admin).post(`${url}/accept`).expect(200);

    const now = await get(member, draft.id);
    expect(now.values).toMatchObject({
      title: 'Монтаж стенду',
      assignees: [member.id, member2.id],
      acceptedBy: admin.id,
    });
    expect(typeof now.values.pointsSplit).toBe('string');
    expect(typeof now.values.acceptedAt).toBe('string');
    expect(zoneText(now.content, 'requirements')).toBe('Стенд закріплено');
    const printed = await as(app, member)
      .get(`/api/papers/${draft.id}/print`)
      .expect(200);
    expect(printed.text).toContain('ТЕХНІЧНЕ ЗАВДАННЯ');
    expect(printed.text).toContain(`ТЗ-${YEAR}-001`);
    expect(printed.text).toContain('Монтаж стенду');
  });

  describe('документ для старого ТЗ (for-record)', () => {
    it('з поточних значень ТЗ, одразу опублікований, з номером і зв’язком; аудит', async () => {
      const task = await makeTask(app, admin, {
        title: 'Афіша',
        description: 'Афіша до свята\nформат А3',
        points: 8,
        maxAssignees: 2,
        dueDate: '2026-12-05T10:00:00.000Z',
      });
      const res = await forRecord(mod, task.id).expect(201);
      const p = res.body as Paper;
      expect(p).toMatchObject({
        status: 'published',
        number: `ТЗ-${YEAR}-001`,
        targetType: 'task',
        targetId: task.id,
        canChange: true,
        values: {
          title: 'Афіша',
          points: 8,
          maxAssignees: 2,
          dueDate: '2026-12-05T10:00:00.000Z',
        },
      });
      expect(zoneText(p.content, 'goal')).toBe('Афіша до свята\nформат А3');
      // Неприв’язане лишається порожнім.
      expect(zoneText(p.content, 'requirements')).toBe('');

      const [log] = await audit('paper.published');
      expect(log).toMatchObject({ actorId: mod.id, entityId: p.id });
      expect(log.meta).toMatchObject({
        number: `ТЗ-${YEAR}-001`,
        targetType: 'task',
        targetId: task.id,
        fromRecord: true,
      });
      const links = await as(app, member)
        .get(`/api/links?type=task&id=${task.id}`)
        .expect(200);
      expect(links.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'paper', recordId: p.id }),
        ]),
      );
      expect(
        (await as(app, member).get(`/api/tasks/${task.id}`).expect(200)).body
          .paper,
      ).toEqual({ id: p.id, number: `ТЗ-${YEAR}-001` });

      // Далі ТЗ змінюється через документ.
      await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, values: { ...p.values, points: 9 } })
        .expect(200);
      expect(
        (await as(app, member).get(`/api/tasks/${task.id}`).expect(200)).body
          .points,
      ).toBe(9);
    });

    it('ТЗ уже має документ — 409 PAPER_TARGET_TAKEN, навіть разом', async () => {
      const task = await makeTask(app, admin);
      const both = await Promise.all([
        forRecord(mod, task.id, templates.full),
        forRecord(admin, task.id, templates.short),
      ]);
      expect(both.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(both.find((r) => r.status === 409)!.body.errorCode).toBe(
        'PAPER_TARGET_TAKEN',
      );
      expect(
        (
          await ds.query<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM papers WHERE target_id = $1`,
            [task.id],
          )
        )[0].n,
      ).toBe(1);
    });

    it('шаблон, що не створює записів, — 400 TEMPLATE_KIND_INVALID; немає ТЗ — 404', async () => {
      const free = (
        await as(app, mod)
          .post('/api/papers/templates')
          .send({ title: 'Заява', kind: 'free' })
          .expect(201)
      ).body as { id: string };
      await as(app, mod)
        .patch(`/api/papers/templates/${free.id}/versions/1`)
        .send({
          revision: 1,
          fields: [],
          body: { type: 'doc', content: [{ type: 'paragraph' }] },
        })
        .expect(200);
      await as(app, mod)
        .post(`/api/papers/templates/${free.id}/versions/1/publish`)
        .expect(201);
      const task = await makeTask(app, admin);
      const kind = await forRecord(mod, task.id, free.id).expect(400);
      expect(kind.body.errorCode).toBe('TEMPLATE_KIND_INVALID');
      await forRecord(mod, '00000000-0000-4000-8000-000000000000').expect(404);
      expect(await audit('paper.published')).toHaveLength(0);
    });
  });
});
