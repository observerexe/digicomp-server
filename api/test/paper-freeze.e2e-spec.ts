import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { PaperSnapshot } from '../src/paperwork/paper-snapshot.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  disciplineTemplates,
  makeUser,
  publishTaskPaper,
  resetDb,
  taskTemplates,
  TestUser,
} from './helpers';

// Фіксація (4.1): знімок аркуша з SHA-256, автофіксація за шаблоном,
// друк лише зі знімка (інакше водяний знак), перевірка за хешем.

type Paper = {
  id: string;
  status: string;
  number: string | null;
  revision: number;
  targetId: string | null;
  values: Record<string, unknown>;
  canFreeze: boolean;
  canCancel: boolean;
  snapshot: { n: number; sha256: string; createdAt: string } | null;
};

type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};

/** The doc with the zone `key` holding this text. */
const withZone = (n: Node, key: string, text: string): Node =>
  n.type === 'fieldZone' && n.attrs?.key === key
    ? {
        ...n,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      }
    : n.content
      ? { ...n, content: n.content.map((c) => withZone(c, key, text)) }
      : n;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('Фіксація документів (e2e)', () => {
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
    delete process.env.PUBLIC_ORIGIN;
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    delete process.env.PUBLIC_ORIGIN;
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    member2 = await makeUser(app, Role.Member);
    templates = await taskTemplates(app);
  });

  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const freeze = (u: TestUser, id: string) =>
    as(app, u).post(`/api/papers/${id}/freeze`);
  const print = (u: TestUser, id: string, query = '') =>
    as(app, u).get(`/api/papers/${id}/print${query}`);
  const verify = (u: TestUser, sha: string) =>
    as(app, u).get(`/api/papers/verify/${sha}`);
  const audit = (action: string) =>
    ds.getRepository(AuditLog).findBy({ action });
  const code = (
    res: { status: number; body: { errorCode?: string } },
    status: number,
    errorCode: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body.errorCode).toBe(errorCode);
  };

  /** A free document of `u`, published (visible to the author only). */
  const freePaper = async (u: TestUser, text = 'Протокол') => {
    const p = (
      await as(app, u)
        .post('/api/papers')
        .send({ title: 'Протокол', content: doc(text) })
        .expect(201)
    ).body as Paper;
    await as(app, u).post(`/api/papers/${p.id}/publish`).expect(200);
    return get(u, p.id);
  };

  /** A task of «Технічне завдання» by the moderator, taken and submitted by `who`. */
  const submittedTask = async (who: TestUser) => {
    const res = await publishTaskPaper(app, mod, templates.full);
    expect(res.status).toBe(200);
    const p = res.body as Paper;
    const task = p.targetId!;
    await as(app, who).post(`/api/tasks/${task}/take`).expect(200);
    await as(app, who).post(`/api/tasks/${task}/start`).expect(200);
    await as(app, who).post(`/api/tasks/${task}/submit`).expect(200);
    return { paper: p, task };
  };

  describe('вільний документ', () => {
    it('автор фіксує: знімок, стан «Зафіксовано», аудит; удруге — PAPER_FROZEN', async () => {
      const p = await freePaper(member);
      expect(p).toMatchObject({
        status: 'published',
        canFreeze: true,
        snapshot: null,
      });
      const res = await freeze(member, p.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'frozen',
        canFreeze: false,
        canCancel: true,
        revision: p.revision + 1,
        snapshot: { n: 1 },
      });
      const sha = (res.body as Paper).snapshot!.sha256;
      expect(sha).toMatch(/^[0-9a-f]{64}$/);
      const [snap] = await ds.getRepository(PaperSnapshot).findBy({
        paperId: p.id,
      });
      expect(snap!.html).toBe(
        `<main class="paper" data-paper="${p.id}" data-snapshot="1"><p>Протокол</p></main>`,
      );
      expect(createHash('sha256').update(snap!.html).digest('hex')).toBe(sha);
      expect(snap!.createdById).toBe(member.id);

      const [log] = await audit('paper.frozen');
      expect(log).toMatchObject({ actorId: member.id, entityId: p.id });
      expect(log!.meta).toMatchObject({ n: 1, sha256: sha });
      expect(log!.meta).not.toHaveProperty('auto');

      code(await freeze(member, p.id), 409, 'PAPER_FROZEN');
    });

    it('чернетку й скасований не фіксують — PAPER_NOT_PUBLISHED', async () => {
      const d = (
        await as(app, member)
          .post('/api/papers')
          .send({ content: doc('x') })
          .expect(201)
      ).body as Paper;
      code(await freeze(member, d.id), 409, 'PAPER_NOT_PUBLISHED');
      const p = await freePaper(member);
      await as(app, member)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'помилка' })
        .expect(200);
      code(await freeze(member, p.id), 409, 'PAPER_NOT_PUBLISHED');
    });

    it('чужий учасник не фіксує; модератор і адмін — будь-який', async () => {
      const p = await freePaper(member);
      await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, visibility: 'members' })
        .expect(200);
      expect((await get(member2, p.id)).canFreeze).toBe(false);
      code(await freeze(member2, p.id), 403, 'NOT_OWNER');
      expect((await get(mod, p.id)).canFreeze).toBe(true);
      expect((await freeze(mod, p.id)).status).toBe(200);

      const q = await freePaper(member, 'Інше');
      expect((await freeze(admin, q.id)).status).toBe(200);
    });
  });

  describe('документ, що створює запис', () => {
    it('ТЗ не готове — PAPER_TARGET_NOT_READY; учасник документа ТЗ не фіксує', async () => {
      const res = await publishTaskPaper(app, mod, templates.short);
      const p = res.body as Paper;
      expect(p).toMatchObject({ status: 'published', canFreeze: false });
      code(await freeze(mod, p.id), 409, 'PAPER_TARGET_NOT_READY');
      code(await freeze(member, p.id), 403, 'NOT_OWNER');
    });

    it('автофіксація: прийняли ТЗ — документ зафіксовано з виконавцями; аудит auto від того, хто прийняв', async () => {
      const { paper, task } = await submittedTask(member);
      expect((await get(mod, paper.id)).status).toBe('published');
      await as(app, admin).post(`/api/tasks/${task}/accept`).expect(200);

      const p = await get(member, paper.id);
      expect(p).toMatchObject({ status: 'frozen', snapshot: { n: 1 } });
      // What it showed of the task stays with it.
      expect(p.values).toMatchObject({
        title: 'ТЗ',
        points: 10,
        assignees: [member.id],
        acceptedBy: admin.id,
      });
      const [snap] = await ds
        .getRepository(PaperSnapshot)
        .findBy({ paperId: paper.id });
      expect(snap!.html).toContain(member.name);
      expect(snap!.resolvedValues).toMatchObject({ assignees: [member.id] });
      const [log] = await audit('paper.frozen');
      expect(log).toMatchObject({ actorId: admin.id, entityId: paper.id });
      expect(log!.meta).toMatchObject({ auto: true, n: 1 });
      // Its assignee finds it among documents about them.
      const about = await as(app, member)
        .get('/api/papers?about=me')
        .expect(200);
      expect(about.body.items.map((x: Paper) => x.id)).toContain(paper.id);
    });

    it('без автофіксації: прийняте ТЗ чекає кнопки; «до фіксації» на Головній модератора', async () => {
      await as(app, mod)
        .patch(`/api/papers/templates/${templates.full}`)
        .send({ autoFreeze: false })
        .expect(200);
      const { paper, task } = await submittedTask(member);
      const due = () => as(app, mod).get('/api/papers?due=freeze').expect(200);
      expect((await due()).body.items).toEqual([]);

      await as(app, mod).post(`/api/tasks/${task}/accept`).expect(200);
      const p = await get(mod, paper.id);
      expect(p).toMatchObject({ status: 'published', canFreeze: true });
      const free = await freePaper(member2);
      const list = (await due()).body;
      expect(list.total).toBe(2);
      expect(list.items.map((x: Paper) => x.id).sort()).toEqual(
        [paper.id, free.id].sort(),
      );
      // A member: only own free documents.
      const mine = await as(app, member2)
        .get('/api/papers?due=freeze')
        .expect(200);
      expect(mine.body.items.map((x: Paper) => x.id)).toEqual([free.id]);

      expect((await freeze(mod, paper.id)).status).toBe(200);
      expect((await due()).body.items.map((x: Paper) => x.id)).toEqual([
        free.id,
      ]);
    });

    it('подання про стягнення фіксується разом із публікацією', async () => {
      const { issue } = await disciplineTemplates(app);
      const d = (
        await as(app, mod)
          .post('/api/papers')
          .send({ templateId: issue })
          .expect(201)
      ).body as Paper & { content: unknown };
      const filled = await as(app, mod)
        .patch(`/api/papers/${d.id}`)
        .send({
          revision: d.revision,
          values: { userId: member.id, type: 'warning' },
          content: withZone(d.content as Node, 'reason', 'запізнення'),
        });
      expect(filled.status).toBe(200);
      const res = await as(app, mod).post(`/api/papers/${d.id}/publish`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'frozen', snapshot: { n: 1 } });
    });
  });

  describe('друк', () => {
    it('не зафіксований — поточний вміст з водяним знаком', async () => {
      const d = (
        await as(app, member)
          .post('/api/papers')
          .send({ content: doc('Текст') })
          .expect(201)
      ).body as Paper;
      const draft = await print(member, d.id).expect(200);
      expect(draft.text).toContain(
        '<div class="watermark" aria-hidden="true">Чернетка</div>',
      );
      expect(draft.text).toContain('<main class="paper"><p>Текст</p></main>');
      expect(draft.text).not.toContain('class="seal"');

      const p = await freePaper(member);
      expect((await print(member, p.id).expect(200)).text).toContain(
        '>Не зафіксовано</div>',
      );
    });

    it('зафіксований — знімок з печаткою й QR, без водяного знака; ?snapshot=', async () => {
      process.env.PUBLIC_ORIGIN = 'https://digicomp.example/';
      const p = await freePaper(member);
      const sha = ((await freeze(member, p.id)).body as Paper).snapshot!.sha256;
      const res = await print(member, p.id).expect(200);
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      const sheet = /<main class="paper"[^>]*>[\s\S]*?<\/main>/.exec(
        res.text,
      )![0];
      expect(createHash('sha256').update(sheet).digest('hex')).toBe(sha);
      expect(res.text).toContain('<footer class="seal"><svg');
      expect(res.text).toContain(`SHA-256: ${sha}`);
      expect(res.text).not.toContain('class="watermark"');
      expect((await print(member, p.id, '?snapshot=1').expect(200)).text).toBe(
        res.text,
      );
      code(
        await print(member, p.id, '?snapshot=2'),
        404,
        'PAPER_SNAPSHOT_NOT_FOUND',
      );
    });

    it('скасований після фіксації — той самий знімок із «Скасовано»', async () => {
      const p = await freePaper(member);
      const sha = ((await freeze(member, p.id)).body as Paper).snapshot!.sha256;
      await as(app, member)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'помилка' })
        .expect(200);
      const res = await print(member, p.id).expect(200);
      expect(res.text).toContain(`SHA-256: ${sha}`);
      expect(res.text).toContain('>Скасовано</div>');
      expect(res.text).not.toContain('<svg'); // no PUBLIC_ORIGIN
    });
  });

  describe('перевірка за хешем', () => {
    it('будь-хто з учасників: справжній і стан; відкрити — лише хто бачить документ', async () => {
      const p = await freePaper(member);
      const sha = ((await freeze(member, p.id)).body as Paper).snapshot!.sha256;
      const other = await verify(member2, sha).expect(200);
      expect(other.body).toMatchObject({
        sha256: sha,
        n: 1,
        latest: true,
        title: 'Протокол',
        status: 'frozen',
        frozenBy: { id: member.id, name: member.name },
        paperId: null,
      });
      expect((await verify(member, sha).expect(200)).body.paperId).toBe(p.id);
      expect((await verify(mod, sha).expect(200)).body.paperId).toBe(p.id);

      await as(app, member)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'помилка' })
        .expect(200);
      expect((await verify(member2, sha).expect(200)).body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'помилка',
      });
    });

    it('невідомий чи кривий хеш — PAPER_SNAPSHOT_NOT_FOUND', async () => {
      code(
        await verify(member, 'f'.repeat(64)),
        404,
        'PAPER_SNAPSHOT_NOT_FOUND',
      );
      code(await verify(member, 'not-a-hash'), 404, 'PAPER_SNAPSHOT_NOT_FOUND');
    });
  });
});
