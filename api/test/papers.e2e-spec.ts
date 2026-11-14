import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

type Paper = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  author: { id: string; name: string | null };
  revision: number;
  content?: unknown;
  canEdit?: boolean;
  updatedAt: string;
};
type List = { items: Paper[]; total: number; page: number; limit: number };

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('Документи редактора (e2e)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let mod: TestUser;
  let mod2: TestUser;
  let member: TestUser;
  let member2: TestUser;

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
    mod2 = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    member2 = await makeUser(app, Role.Member);
  });

  const create = async (u: TestUser, body: object = {}) => {
    const res = await as(app, u).post('/api/papers').send(body).expect(201);
    return res.body as Paper;
  };
  const list = async (u: TestUser, query = '') =>
    (await as(app, u).get(`/api/papers${query}`).expect(200)).body as List;
  const titles = (l: List) => l.items.map((p) => p.title).sort();
  /** Published states are reached through later sessions; set them here. */
  const setState = (id: string, status: string, visibility = 'author') =>
    app
      .get(DataSource)
      .query(`UPDATE papers SET status = $2, visibility = $3 WHERE id = $1`, [
        id,
        status,
        visibility,
      ]);
  const audit = (action: string, entityId: string) =>
    app
      .get(DataSource)
      .getRepository(AuditLog)
      .findBy({ action, entity: 'paper', entityId });

  describe('створення', () => {
    it('без нічого — «Без назви», порожній абзац, чернетка; аудит', async () => {
      const p = await create(member);
      expect(p).toMatchObject({
        title: 'Без назви',
        status: 'draft',
        visibility: 'author',
        revision: 1,
        author: { id: member.id, name: member.name },
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        canEdit: true,
      });
      expect(await audit('paper.created', p.id)).toHaveLength(1);
    });

    it('з назвою (пробіли обрізаються) і вмістом', async () => {
      const p = await create(mod, {
        title: '  Протокол ',
        content: doc('Текст'),
      });
      expect(p.title).toBe('Протокол');
      expect(p.content).toEqual(doc('Текст'));
    });

    it.each([
      ['порожня назва', { title: '   ' }],
      ['задовга назва', { title: 'x'.repeat(201) }],
      ['вміст не документ', { content: { type: 'paragraph' } }],
      ['атрибут style у вузлі', { content: { type: 'doc', style: 'x' } }],
      [
        'вузол не зі спільного опису',
        { content: { type: 'doc', content: [{ type: 'image' }] } },
      ],
      [
        'розмір шрифту не з набору',
        {
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'x',
                    marks: [{ type: 'textStyle', attrs: { size: 99 } }],
                  },
                ],
              },
            ],
          },
        },
      ],
      ['зайве поле', { status: 'published' }],
    ])('%s — 400', async (_l, body) => {
      const res = await as(app, member).post('/api/papers').send(body);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('довгий документ (понад 100 КБ) приймається, понад 1 МБ — ні', async () => {
      const para = 'а'.repeat(1000);
      const big = (n: number) => ({
        type: 'doc',
        content: Array.from({ length: n }, () => ({
          type: 'paragraph',
          content: [{ type: 'text', text: para }],
        })),
      });
      await as(app, member)
        .post('/api/papers')
        .send({ content: big(200) })
        .expect(201);
      const res = await as(app, member)
        .post('/api/papers')
        .send({ content: big(600) });
      expect(res.status).toBe(413);
    });
  });

  describe('хто що бачить', () => {
    let own: Paper;
    let modDraft: Paper;
    let published: Paper;
    let shared: Paper;
    beforeEach(async () => {
      own = await create(member, { title: 'Моя чернетка' });
      modDraft = await create(mod, { title: 'Чернетка модератора' });
      published = await create(mod, { title: 'Опублікований' });
      shared = await create(mod, { title: 'Для всіх' });
      await setState(published.id, 'published', 'author');
      await setState(shared.id, 'published', 'members');
    });

    it('учасник: свої й опубліковані для всіх', async () => {
      expect(titles(await list(member))).toEqual(['Для всіх', 'Моя чернетка']);
      expect(titles(await list(member2))).toEqual(['Для всіх']);
      await as(app, member).get(`/api/papers/${own.id}`).expect(200);
      await as(app, member2).get(`/api/papers/${shared.id}`).expect(200);
      for (const id of [own.id, modDraft.id, published.id]) {
        const res = await as(app, member2).get(`/api/papers/${id}`);
        expect(res.status).toBe(404);
        expect(res.body.errorCode).toBe('PAPER_NOT_FOUND');
      }
    });

    it('чернетка для всіх не видна, доки не опублікована', async () => {
      await setState(own.id, 'draft', 'members');
      expect(titles(await list(member2))).toEqual(['Для всіх']);
    });

    it('модератор і адмін бачать усі, зокрема чужі чернетки', async () => {
      const all = [
        'Для всіх',
        'Моя чернетка',
        'Опублікований',
        'Чернетка модератора',
      ];
      expect(titles(await list(mod2))).toEqual(all);
      expect(titles(await list(admin))).toEqual(all);
      const res = await as(app, mod2).get(`/api/papers/${own.id}`).expect(200);
      expect(res.body).toMatchObject({
        content: { type: 'doc' },
        canEdit: false,
      });
    });

    it('«Мої», пошук за назвою, сторінки; без вмісту в списку', async () => {
      expect(titles(await list(mod, '?mine=true'))).toEqual([
        'Для всіх',
        'Опублікований',
        'Чернетка модератора',
      ]);
      expect(titles(await list(member, '?search=всіх'))).toEqual(['Для всіх']);
      expect(titles(await list(mod2, '?search=%25'))).toEqual([]);
      const page = await list(admin, '?limit=3&page=2');
      expect(page).toMatchObject({ total: 4, page: 2, limit: 3 });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].content).toBeUndefined();
      expect(page.items[0].author.name).toBeTruthy();
    });

    it('нещодавно змінені — першими', async () => {
      const first = await list(mod2);
      const last = first.items[first.items.length - 1];
      await as(app, admin)
        .patch(`/api/papers/${last.id}`)
        .send({ revision: last.revision, visibility: 'members' })
        .expect(200);
      expect((await list(mod2)).items[0].id).toBe(last.id);
    });
  });

  describe('зміна', () => {
    it('автор зберігає чернетку: revision росте, аудиту немає', async () => {
      const p = await create(member);
      const res = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, title: 'Звіт', content: doc('Один') })
        .expect(200);
      expect(res.body).toMatchObject({ title: 'Звіт', revision: 2 });
      expect(res.body.content).toBeUndefined();
      await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 2, content: doc('Два') })
        .expect(200);
      const got = await as(app, member).get(`/api/papers/${p.id}`).expect(200);
      expect(got.body).toMatchObject({ revision: 3, content: doc('Два') });
      expect(await audit('paper.updated', p.id)).toHaveLength(0);
    });

    it('стара revision — 409 PAPER_CONFLICT, нічого не змінюється', async () => {
      const p = await create(member);
      await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, content: doc('Вкладка А') })
        .expect(200);
      const res = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, content: doc('Вкладка Б') });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('PAPER_CONFLICT');
      const got = await as(app, member).get(`/api/papers/${p.id}`);
      expect(got.body).toMatchObject({
        revision: 2,
        content: doc('Вкладка А'),
      });
    });

    it('без змін — revision та сама', async () => {
      const p = await create(member, { title: 'Те саме' });
      const res = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, title: 'Те саме' })
        .expect(200);
      expect(res.body.revision).toBe(1);
    });

    it('revision обовʼязкова', async () => {
      const p = await create(member);
      await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ title: 'Х' })
        .expect(400);
    });

    it('модератор чужу чернетку бачить, але не змінює й не видаляє', async () => {
      const p = await create(member);
      const res = await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, title: 'Х' });
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('NOT_OWNER');
      const del = await as(app, mod).delete(`/api/papers/${p.id}`);
      expect(del.status).toBe(403);
      expect(del.body.errorCode).toBe('NOT_OWNER');
    });

    it('адмін змінює чужу чернетку; це в аудиті', async () => {
      const p = await create(member);
      await as(app, admin)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, title: 'Виправлено', content: doc('x') })
        .expect(200);
      const [log] = await audit('paper.updated', p.id);
      expect(log).toMatchObject({
        actorId: admin.id,
        meta: {
          authorId: member.id,
          changes: { title: { from: 'Без назви', to: 'Виправлено' } },
          content: true,
        },
      });
    });

    it('учасник чужий опублікований документ не змінює', async () => {
      const p = await create(mod);
      await setState(p.id, 'published', 'members');
      const res = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, title: 'Х' });
      expect(res.status).toBe(403);
    });

    it('не чернетка — 409 PAPER_NOT_DRAFT для назви й вмісту', async () => {
      const p = await create(member);
      await setState(p.id, 'published');
      const res = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, content: doc('x') });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('PAPER_NOT_DRAFT');
      const got = await as(app, member).get(`/api/papers/${p.id}`);
      expect(got.body.canEdit).toBe(false);
    });
  });

  describe('видимість', () => {
    it('модератор робить документ видимим для всіх; аудит', async () => {
      const p = await create(member);
      await setState(p.id, 'published');
      const res = await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, visibility: 'members' })
        .expect(200);
      expect(res.body).toMatchObject({ visibility: 'members', revision: 2 });
      await as(app, member2).get(`/api/papers/${p.id}`).expect(200);
      const [log] = await audit('paper.updated', p.id);
      expect(log).toMatchObject({
        actorId: mod.id,
        meta: { changes: { visibility: { from: 'author', to: 'members' } } },
      });
    });

    it('учасник — ні, навіть для свого', async () => {
      const p = await create(member);
      const res = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, visibility: 'members' });
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('FORBIDDEN');
    });
  });

  describe('видалення', () => {
    it('автор видаляє свою чернетку; аудит', async () => {
      const p = await create(member, { title: 'Зайве' });
      await as(app, member).delete(`/api/papers/${p.id}`).expect(200);
      await as(app, member).get(`/api/papers/${p.id}`).expect(404);
      const [log] = await audit('paper.deleted', p.id);
      expect(log).toMatchObject({
        actorId: member.id,
        meta: { title: 'Зайве', authorId: member.id },
      });
    });

    it('адмін — чужу', async () => {
      const p = await create(mod);
      await as(app, admin).delete(`/api/papers/${p.id}`).expect(200);
    });

    it('не чернетку — 409 PAPER_NOT_DRAFT', async () => {
      const p = await create(member);
      await setState(p.id, 'published');
      const res = await as(app, member).delete(`/api/papers/${p.id}`);
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('PAPER_NOT_DRAFT');
    });

    it('чужу, яку не бачить, — 404', async () => {
      const p = await create(member);
      const res = await as(app, member2).delete(`/api/papers/${p.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('друк', () => {
    it('аркуш A4: шапка з реквізитів, вміст, власний CSP без скриптів', async () => {
      await as(app, admin)
        .patch('/api/org-settings')
        .send({ institution: 'КОЛЕДЖ', groupName: 'Творча група' })
        .expect(200);
      const p = await create(member, {
        title: 'Звіт <1>',
        content: doc('Текст & ще'),
      });
      const res = await as(app, member)
        .get(`/api/papers/${p.id}/print`)
        .expect(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      const csp = res.headers['content-security-policy'];
      expect(csp).toMatch(/^default-src 'none'; style-src 'sha256-/);
      expect(csp).toContain("font-src 'self'");
      expect(csp).not.toContain('script-src');
      expect(res.text).toContain('<title>Звіт &lt;1&gt;</title>');
      expect(res.text).toContain(
        '<main class="paper"><header class="org"><p class="org-institution">КОЛЕДЖ</p><p class="org-group">Творча група</p></header><p>Текст &amp; ще</p></main>',
      );
    });

    it('друкує поточний вміст після зміни', async () => {
      const p = await create(member, { content: doc('старе') });
      await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, content: doc('нове') })
        .expect(200);
      const res = await as(app, member)
        .get(`/api/papers/${p.id}/print`)
        .expect(200);
      expect(res.text).toContain('<p>нове</p>');
      expect(res.text).not.toContain('старе');
    });

    it('хто бачить документ — той і друкує; інші — 404', async () => {
      const draft = await create(member);
      await as(app, mod).get(`/api/papers/${draft.id}/print`).expect(200);
      const res = await as(app, member2).get(`/api/papers/${draft.id}/print`);
      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('PAPER_NOT_FOUND');
      await setState(draft.id, 'published', 'members');
      await as(app, member2).get(`/api/papers/${draft.id}/print`).expect(200);
    });

    it('без входу — 401', async () => {
      const p = await create(member);
      await request(app.getHttpServer())
        .get(`/api/papers/${p.id}/print`)
        .expect(401);
    });
  });

  it('схема paper — лише для читання', async () => {
    const res = await as(app, member)
      .get('/api/records/paper/schema')
      .expect(200);
    const fields = res.body.fields as { key: string; create?: boolean }[];
    expect(fields.map((f) => f.key)).toEqual([
      'title',
      'status',
      'visibility',
      'authorId',
      'createdAt',
      'updatedAt',
    ]);
    expect(fields.some((f) => f.create)).toBe(false);
  });

  it('без входу — 401', async () => {
    await request(app.getHttpServer()).get('/api/papers').expect(401);
  });
});
