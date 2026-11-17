import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeUser,
  publishTaskPaper,
  resetDb,
  taskTemplates,
  TestUser,
  SIGNED,
} from './helpers';

// Архів як єдиний пошук (4.2б): файли й зафіксовані документи редактора
// одним списком; підписаний скан — не окремий рядок; фільтри вид/стан/рік/
// категорія; сторінки після злиття.

type Item = {
  kind: 'file' | 'paper';
  id: string;
  title: string;
  file: { category: string; accessScope: string; archived: boolean } | null;
  paper: {
    number: string | null;
    status: string;
    template: string | null;
    author: { id: string };
  } | null;
};
type List = {
  items: Item[];
  total: number;
  page: number;
  limit: number;
  years: number[];
  categories: string[];
};

const PDF = Buffer.from('%PDF-1.4\n%скан\n', 'utf8');
const content = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('Архів (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let member2: TestUser;
  let orders: string;
  let manuals: string;

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
    orders = await category(app, 'document_category', 'Накази');
    manuals = await category(app, 'document_category', 'Інструкції');
  });

  const list = async (u: TestUser, query = '') =>
    (
      await as(app, u)
        .get(encodeURI(`/api/archive${query}`))
        .expect(200)
    ).body as List;
  const titles = (l: List) =>
    l.items.map((x) => x.title).sort((a, b) => a.localeCompare(b, 'uk'));

  const file = async (
    title: string,
    opts: {
      category?: string;
      accessScope?: string;
      description?: string;
    } = {},
  ) =>
    (
      await as(app, mod)
        .post('/api/documents')
        .field('title', title)
        .field('category', opts.category ?? orders)
        .field('accessScope', opts.accessScope ?? 'members')
        .field('description', opts.description ?? '')
        .attach('file', Buffer.from('текст'), 'a.txt')
        .expect(201)
    ).body.id as string;

  /** A free document of `u`: published, then frozen if `frozen`. */
  const paper = async (
    u: TestUser,
    title: string,
    { frozen = true, members = false } = {},
  ) => {
    const p = (
      await as(app, u)
        .post('/api/papers')
        .send({ title, content: content(title) })
        .expect(201)
    ).body as { id: string; revision: number };
    const pub = await as(app, u)
      .post(`/api/papers/${p.id}/publish`)
      .send(SIGNED)
      .expect(200);
    if (members) {
      await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: pub.body.revision, visibility: 'members' })
        .expect(200);
    }
    if (frozen)
      await as(app, u)
        .post(`/api/papers/${p.id}/freeze`)
        .send(SIGNED)
        .expect(200);
    return p.id;
  };

  const touch = (table: string, id: string, at: string) =>
    ds.query(`UPDATE ${table} SET updated_at = $2 WHERE id = $1`, [id, at]);

  describe('що в Архіві', () => {
    it('учасник: файли для всіх і зафіксовані документи, які бачить; чернеток, опублікованих і чужих — ні', async () => {
      await file('Наказ');
      await file('Лише для модераторів', { accessScope: 'supervisors' });
      await paper(member, 'Мій протокол');
      await paper(member, 'Опублікований', { frozen: false });
      await as(app, member)
        .post('/api/papers')
        .send({ title: 'Чернетка', content: content('Чернетка') })
        .expect(201);
      await paper(member2, 'Чужий');
      await paper(member2, 'Для всіх', { members: true });

      expect(titles(await list(member))).toEqual([
        'Для всіх',
        'Мій протокол',
        'Наказ',
      ]);
      expect(titles(await list(mod))).toEqual([
        'Для всіх',
        'Лише для модераторів',
        'Мій протокол',
        'Наказ',
        'Чужий',
      ]);
    });

    it('рядок документа: стан, автор, без шаблону; рядок файлу — категорія', async () => {
      const id = await paper(member, 'Протокол');
      await file('Наказ');
      const { items } = await list(member);
      expect(items.find((x) => x.id === id)).toMatchObject({
        kind: 'paper',
        file: null,
        paper: { status: 'frozen', template: null, author: { id: member.id } },
      });
      expect(items.find((x) => x.kind === 'file')).toMatchObject({
        title: 'Наказ',
        paper: null,
        file: { category: orders, accessScope: 'members', archived: false },
      });
    });

    it('документ виконаного ТЗ: після прийняття — в Архіві з номером і шаблоном', async () => {
      const templates = await taskTemplates(app);
      const res = await publishTaskPaper(app, mod, templates.full);
      expect(res.status).toBe(200);
      const task = res.body.targetId as string;
      expect((await list(member)).items).toEqual([]);

      await as(app, member).post(`/api/tasks/${task}/take`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/start`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/submit`).expect(200);
      await as(app, admin)
        .post(`/api/tasks/${task}/accept`)
        .send(SIGNED)
        .expect(200);

      const { items } = await list(member);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: res.body.id,
        kind: 'paper',
        paper: {
          status: 'frozen',
          number: res.body.number,
          template: 'Технічне завдання',
        },
      });
    });

    it('підписаний документ — один рядок «Підписано»; файл скану окремо не показано', async () => {
      const id = await paper(member, 'Протокол');
      await as(app, member)
        .post(`/api/papers/${id}/signed`)
        .attach('file', PDF, 'скан.pdf')
        .expect(200);

      for (const u of [member, mod]) {
        const l = await list(u);
        expect(l.total).toBe(1);
        expect(l.items).toMatchObject([
          { id, kind: 'paper', paper: { status: 'signed' } },
        ]);
        expect(l.categories).toEqual([]);
      }
    });

    it('скасований після фіксації — в Архіві «Скасовано»; скасований без знімка — ні', async () => {
      const frozen = await paper(member, 'Був зафіксований');
      const plain = await paper(member, 'Не фіксували', { frozen: false });
      for (const id of [frozen, plain]) {
        await as(app, member)
          .post(`/api/papers/${id}/cancel`)
          .send({ reason: 'помилка' })
          .expect(200);
      }
      expect((await list(member)).items).toMatchObject([
        { id: frozen, paper: { status: 'cancelled' } },
      ]);
    });
  });

  describe('фільтри', () => {
    let fileOld: string;
    let paperOld: string;

    beforeEach(async () => {
      fileOld = await file('Наказ 2024', { description: 'про практику' });
      await file('Інструкція з безпеки', { category: manuals });
      paperOld = await paper(member, 'Протокол 2024');
      const signed = await paper(member, 'Підписаний протокол');
      await as(app, member)
        .post(`/api/papers/${signed}/signed`)
        .attach('file', PDF, 'скан.pdf')
        .expect(200);
      await ds.query(
        `UPDATE documents SET created_at = '2024-05-01T12:00:00Z' WHERE id = $1`,
        [fileOld],
      );
      await ds.query(
        `UPDATE papers SET published_at = '2024-12-31T23:30:00Z' WHERE id = $1`,
        [paperOld],
      );
    });

    it('вид', async () => {
      expect(titles(await list(member, '?kind=file'))).toEqual([
        'Інструкція з безпеки',
        'Наказ 2024',
      ]);
      expect(titles(await list(member, '?kind=paper'))).toEqual([
        'Підписаний протокол',
        'Протокол 2024',
      ]);
    });

    it('стан — лише документи', async () => {
      expect(titles(await list(member, '?status=signed'))).toEqual([
        'Підписаний протокол',
      ]);
      expect(titles(await list(member, '?status=frozen'))).toEqual([
        'Протокол 2024',
      ]);
      await as(app, member).get('/api/archive?status=draft').expect(400);
    });

    it('категорія — лише файли', async () => {
      expect(titles(await list(member, `?category=${manuals}`))).toEqual([
        'Інструкція з безпеки',
      ]);
    });

    it('рік: файл — за додаванням, документ — за публікацією (київський час); роки — з усього, що бачить читач', async () => {
      const now = new Date().getFullYear();
      // 23:30 UTC 31 грудня — у Києві вже 2025.
      expect(titles(await list(member, '?year=2024'))).toEqual(['Наказ 2024']);
      expect(titles(await list(member, '?year=2025'))).toEqual([
        'Протокол 2024',
      ]);
      const l = await list(member, '?year=2024&kind=file');
      expect(l.years).toEqual(
        [...new Set([now, 2025, 2024])].sort((x, y) => y - x),
      );
      expect(l.categories.sort()).toEqual([manuals, orders].sort());
      await as(app, member).get('/api/archive?year=24').expect(400);
    });

    it('пошук: файли — назва, опис, категорія; документи — назва й номер', async () => {
      expect(titles(await list(member, '?search=практику'))).toEqual([
        'Наказ 2024',
      ]);
      expect(titles(await list(member, '?search=Інструкції'))).toEqual([
        'Інструкція з безпеки',
      ]);
      expect(titles(await list(member, '?search=протокол'))).toEqual([
        'Підписаний протокол',
        'Протокол 2024',
      ]);
      await ds.query(`UPDATE papers SET number = 'ПР-2024-007' WHERE id = $1`, [
        paperOld,
      ]);
      expect(titles(await list(member, '?search=ПР-2024'))).toEqual([
        'Протокол 2024',
      ]);
    });

    it('архівні файли — лише модератору й без документів; учаснику прапорець нічого не змінює', async () => {
      await as(app, mod).post(`/api/documents/${fileOld}/archive`).expect(200);
      const staff = await list(mod, '?archived=true');
      expect(staff.items).toMatchObject([
        { id: fileOld, file: { archived: true } },
      ]);
      expect(staff.years).toEqual([2024]);
      expect(titles(await list(member, '?archived=true'))).toEqual([
        'Інструкція з безпеки',
        'Підписаний протокол',
        'Протокол 2024',
      ]);
    });
  });

  it('сторінки: файли й документи злито за останньою зміною', async () => {
    const a = await file('A');
    const b = await paper(member, 'B');
    const c = await file('C');
    const d = await paper(member, 'D');
    const e = await file('E');
    await touch('documents', a, '2026-01-05T00:00:00Z');
    await touch('papers', b, '2026-01-04T00:00:00Z');
    await touch('documents', c, '2026-01-03T00:00:00Z');
    await touch('papers', d, '2026-01-02T00:00:00Z');
    await touch('documents', e, '2026-01-01T00:00:00Z');

    const p1 = await list(member, '?limit=2');
    expect(p1).toMatchObject({ total: 5, page: 1, limit: 2 });
    expect(p1.items.map((x) => x.title)).toEqual(['A', 'B']);
    const p2 = await list(member, '?limit=2&page=2');
    expect(p2.items.map((x) => x.title)).toEqual(['C', 'D']);
    const p3 = await list(member, '?limit=2&page=3');
    expect(p3.items.map((x) => x.title)).toEqual(['E']);
  });
});
