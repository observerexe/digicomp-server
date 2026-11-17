import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { PaperSnapshot } from '../src/paperwork/paper-snapshot.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeUser,
  PNG_1PX,
  publishTaskPaper,
  resetDb,
  taskTemplates,
  TestUser,
  SIGNED,
} from './helpers';

// Підпис (4.2а): скан зафіксованого документа стає версією в Архіві,
// документ — «Підписано»; «На мій підпис» і «Завантажити скан» на Головній.

type Signed = {
  version: number;
  fileName: string;
  mimeType: string;
  size: number;
};

type Paper = {
  id: string;
  status: string;
  number: string | null;
  title: string;
  revision: number;
  targetId: string | null;
  canSign: boolean;
  snapshot: { n: number; signed: Signed | null } | null;
};

const PDF = Buffer.from('%PDF-1.4\n%скан\n', 'utf8');

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const para = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('Підпис документів (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let member2: TestUser;

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
    // resetDb empties the dictionaries the migrations make.
    await category(app, 'document_category', 'Накази');
  });

  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const sign = (
    u: TestUser,
    id: string,
    file: Buffer = PDF,
    name = 'скан.pdf',
  ) => as(app, u).post(`/api/papers/${id}/signed`).attach('file', file, name);
  const scan = (u: TestUser, id: string, query = '') =>
    as(app, u).get(`/api/papers/${id}/signed${query}`);
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
  const ids = (body: { items: { id: string }[] }) =>
    body.items.map((x) => x.id).sort();

  /** A free document of `u`: published, and frozen if `frozen`. */
  const freePaper = async (
    u: TestUser,
    content = doc(para('Протокол')),
    frozen = true,
  ) => {
    const p = (
      await as(app, u)
        .post('/api/papers')
        .send({ title: 'Протокол', content })
        .expect(201)
    ).body as Paper;
    await as(app, u).post(`/api/papers/${p.id}/publish`).expect(200);
    // By the admin, whom no line awaits: every line still waits.
    if (frozen) {
      await as(app, admin).post(`/api/papers/${p.id}/freeze`).expect(200);
    }
    return get(u, p.id);
  };

  describe('завантаження скану', () => {
    it('автор вільного: архівний запис «Підписані документи» лише для модераторів, стан «Підписано», аудит', async () => {
      const p = await freePaper(member);
      expect(p).toMatchObject({ status: 'frozen', canSign: true });
      expect(p.snapshot!.signed).toBeNull();

      const res = await sign(member, p.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'signed',
        canSign: true,
        revision: p.revision + 1,
        snapshot: {
          n: 1,
          signed: {
            version: 1,
            fileName: 'скан.pdf',
            mimeType: 'application/pdf',
            size: PDF.length,
          },
        },
      });

      const [snap] = await ds
        .getRepository(PaperSnapshot)
        .findBy({ paperId: p.id });
      const docId = snap!.archiveDocId!;
      expect(docId).toBeTruthy();
      const staff = await as(app, mod).get(`/api/documents/${docId}`);
      expect(staff.status).toBe(200);
      expect(staff.body).toMatchObject({
        title: 'Протокол',
        category: 'signed_papers',
        accessScope: 'supervisors',
        authorId: member.id,
        version: 1,
      });
      // The author sees the scan through the document, not in the Archive.
      expect(
        (await as(app, member).get(`/api/documents/${docId}`)).status,
      ).toBe(404);
      const [item] = await ds.query<{ title: string }[]>(
        `SELECT i.title FROM dictionary_items i JOIN dictionaries d ON d.id = i.dictionary_id
          WHERE d.key = 'document_category' AND i.key = 'signed_papers'`,
      );
      expect(item!.title).toBe('Підписані документи');

      const [log] = await audit('paper.signed');
      expect(log).toMatchObject({ actorId: member.id, entityId: p.id });
      expect(log!.meta).toMatchObject({
        n: 1,
        documentId: docId,
        version: 1,
        fileName: 'скан.pdf',
      });
      expect(await audit('document.created')).toHaveLength(1);
      expect(await audit('dictionary.item_created')).toHaveLength(1);
    });

    it('ще один скан — наступна версія того самого запису; категорія не дублюється', async () => {
      const p = await freePaper(member);
      await sign(member, p.id).expect(200);
      const res = await sign(mod, p.id, PNG_1PX, 'фото.png');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'signed',
        snapshot: { signed: { version: 2, mimeType: 'image/png' } },
      });
      const versions = await ds.query<{ n: string }[]>(
        `SELECT count(*) AS n FROM document_versions`,
      );
      expect(Number(versions[0]!.n)).toBe(2);
      expect(await audit('document.version_added')).toHaveLength(1);
      expect(await audit('paper.signed')).toHaveLength(2);

      // A second document: its own archive record, the same category.
      const q = await freePaper(member);
      await sign(member, q.id).expect(200);
      expect(await audit('dictionary.item_created')).toHaveLength(1);
    });

    it('категорію, створену вручну з такою назвою, бере як є', async () => {
      const key = await category(
        app,
        'document_category',
        'Підписані документи',
      );
      const p = await freePaper(member);
      await sign(member, p.id).expect(200);
      const [snap] = await ds
        .getRepository(PaperSnapshot)
        .findBy({ paperId: p.id });
      const [row] = await ds.query<{ category: string }[]>(
        `SELECT category FROM documents WHERE id = $1`,
        [snap!.archiveDocId],
      );
      expect(row!.category).toBe(key);
      expect(await audit('dictionary.item_created')).toHaveLength(0);
    });

    it('номер документа йде в назву архівного запису', async () => {
      const { full } = await taskTemplates(app);
      const res = await publishTaskPaper(app, mod, full);
      const task = (res.body as Paper).targetId!;
      await as(app, member).post(`/api/tasks/${task}/take`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/start`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/submit`).expect(200);
      await as(app, admin)
        .post(`/api/tasks/${task}/accept`)
        .send(SIGNED)
        .expect(200);
      const p = await get(mod, (res.body as Paper).id);
      expect(p.status).toBe('frozen');
      await sign(mod, p.id).expect(200);
      const [doc] = await ds.query<{ title: string }[]>(
        `SELECT title FROM documents`,
      );
      expect(doc!.title).toBe(`${p.number} ${p.title}`);
    });

    it('не зафіксований — PAPER_NOT_FROZEN: чернетка, опублікований, скасований', async () => {
      const d = (
        await as(app, member)
          .post('/api/papers')
          .send({ content: doc(para('x')) })
          .expect(201)
      ).body as Paper;
      expect(d.canSign).toBe(false);
      code(await sign(member, d.id), 409, 'PAPER_NOT_FROZEN');
      const pub = await freePaper(member, doc(para('y')), false);
      expect(pub.canSign).toBe(false);
      code(await sign(member, pub.id), 409, 'PAPER_NOT_FROZEN');
      const frozen = await freePaper(member);
      await as(app, member)
        .post(`/api/papers/${frozen.id}/cancel`)
        .send({ reason: 'помилка' })
        .expect(200);
      expect((await get(member, frozen.id)).canSign).toBe(false);
      code(await sign(member, frozen.id), 409, 'PAPER_NOT_FROZEN');
      // Nothing was kept: no archive records.
      expect(await ds.query(`SELECT id FROM documents`)).toEqual([]);
    });

    it('файл: потрібен, лише PDF чи фото, перевірка за вмістом', async () => {
      const p = await freePaper(member);
      code(
        await as(app, member).post(`/api/papers/${p.id}/signed`),
        400,
        'FILE_REQUIRED',
      );
      code(
        await sign(member, p.id, Buffer.from('текст'), 'скан.txt'),
        400,
        'FILE_TYPE_NOT_ALLOWED',
      );
      code(
        await sign(member, p.id, Buffer.from('не pdf'), 'скан.pdf'),
        400,
        'FILE_CONTENT_MISMATCH',
      );
      expect((await get(member, p.id)).status).toBe('frozen');
      expect(await ds.query(`SELECT id FROM documents`)).toEqual([]);
    });

    it('права: чужий учасник — ні; документ, що створив запис, — лише модератор і адмін', async () => {
      const p = await freePaper(member);
      await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, visibility: 'members' })
        .expect(200);
      expect((await get(member2, p.id)).canSign).toBe(false);
      code(await sign(member2, p.id), 403, 'NOT_OWNER');
      expect((await get(mod, p.id)).canSign).toBe(true);
      expect((await sign(admin, p.id)).status).toBe(200);

      const { full } = await taskTemplates(app);
      const res = await publishTaskPaper(app, mod, full);
      const task = (res.body as Paper).targetId!;
      await as(app, member).post(`/api/tasks/${task}/take`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/start`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/submit`).expect(200);
      await as(app, admin)
        .post(`/api/tasks/${task}/accept`)
        .send(SIGNED)
        .expect(200);
      const t = await get(member, (res.body as Paper).id);
      expect(t).toMatchObject({ status: 'frozen', canSign: false });
      code(await sign(member, t.id), 403, 'NOT_OWNER');
      expect((await sign(mod, t.id)).status).toBe(200);
    });

    it('невидимий документ — 404', async () => {
      const p = await freePaper(member);
      code(await sign(member2, p.id), 404, 'PAPER_NOT_FOUND');
      code(await scan(member2, p.id), 404, 'PAPER_NOT_FOUND');
    });
  });

  describe('перегляд скану', () => {
    it('хто бачить документ — отримує файл; PDF з inline=1 — у браузері', async () => {
      const p = await freePaper(member);
      code(await scan(member, p.id), 404, 'PAPER_SCAN_NOT_FOUND');
      await sign(member, p.id).expect(200);

      const res = await scan(member, p.id).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^attachment/);
      expect(res.headers['content-length']).toBe(String(PDF.length));
      const inline = await scan(member, p.id, '?inline=1').expect(200);
      expect(inline.headers['content-disposition']).toMatch(/^inline/);
      await scan(mod, p.id).expect(200);

      // A later scan replaces it here; the Archive keeps both versions.
      await sign(member, p.id, PNG_1PX, 'фото.png').expect(200);
      const png = await scan(member, p.id).expect(200);
      expect(png.headers['content-type']).toBe('image/png');
    });

    it('скасований після підпису: скан лишається', async () => {
      const p = await freePaper(member);
      await sign(member, p.id).expect(200);
      await as(app, member)
        .post(`/api/papers/${p.id}/cancel`)
        .send({ reason: 'помилка' })
        .expect(200);
      const after = await get(member, p.id);
      expect(after).toMatchObject({ status: 'cancelled', canSign: false });
      expect(after.snapshot!.signed).toMatchObject({ version: 1 });
      await scan(member, p.id).expect(200);
    });
  });

  describe('Головна: на підпис і завантажити скан', () => {
    const due = async (u: TestUser, what: 'sign' | 'scan') =>
      (await as(app, u).get(`/api/papers?due=${what}`).expect(200)).body as {
        items: { id: string }[];
        total: number;
      };

    it('«На мій підпис»: автор, підписант з «Реквізитів» (підписи й «Затверджую»), учасник з поля', async () => {
      await as(app, admin)
        .patch('/api/org-settings')
        .send({ signerId: mod.id })
        .expect(200);
      // The author signs the left column, the org signer the right one.
      const both = await freePaper(
        member,
        doc(para('a'), {
          type: 'signatures',
          attrs: {
            leftLabel: 'Склав',
            leftSigner: '@author',
            rightLabel: 'Погодив',
            rightSigner: '@signer',
          },
        }),
      );
      // A right signer without a label is not printed: nobody but the author.
      const left = await freePaper(
        member,
        doc(para('b'), {
          type: 'signatures',
          attrs: { leftLabel: 'Склав', rightLabel: '', rightSigner: '@signer' },
        }),
      );
      // «Затверджую» only: the org signer.
      const approval = await freePaper(
        member2,
        doc({ type: 'approval' }, para('c')),
      );
      // A line only: nobody.
      const line = await freePaper(
        member2,
        doc(para('d'), {
          type: 'signatures',
          attrs: { leftLabel: 'Склав', leftSigner: null },
        }),
      );
      // No signatures at all.
      await freePaper(member2, doc(para('e')));
      for (const p of [both, left, approval, line]) {
        const { revision } = await get(admin, p.id);
        await as(app, admin)
          .patch(`/api/papers/${p.id}`)
          .send({ revision, visibility: 'members' })
          .expect(200);
      }

      expect(ids(await due(member, 'sign'))).toEqual([both.id, left.id].sort());
      expect(ids(await due(mod, 'sign'))).toEqual(
        [both.id, approval.id].sort(),
      );
      expect(ids(await due(member2, 'sign'))).toEqual([]);

      // Signed — off the list.
      await sign(mod, both.id).expect(200);
      expect(ids(await due(member, 'sign'))).toEqual([left.id]);
    });

    it('учасник з поля підпису (ТЗ: «Роботу прийняв»), лише видимі документи', async () => {
      const { full } = await taskTemplates(app);
      const res = await publishTaskPaper(app, mod, full);
      const task = (res.body as Paper).targetId!;
      await as(app, member).post(`/api/tasks/${task}/take`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/start`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/submit`).expect(200);
      // Who accepts signs «Роботу прийняв» with it: not on their list.
      await as(app, admin)
        .post(`/api/tasks/${task}/accept`)
        .send(SIGNED)
        .expect(200);
      const id = (res.body as Paper).id;
      expect(ids(await due(admin, 'sign'))).toEqual([]);
      expect(ids(await due(mod, 'sign'))).toEqual([id]);
      expect(ids(await due(member, 'sign'))).toEqual([]);
    });

    it('«Завантажити скан»: зафіксовані не підписані за 30 днів; учаснику — лише свої вільні', async () => {
      const mine = await freePaper(member);
      const other = await freePaper(member2);
      await freePaper(member, doc(para('не зафіксовано')), false);
      const old = await freePaper(member2);
      await ds.query(
        `UPDATE papers SET updated_at = now() - interval '31 days' WHERE id = $1`,
        [old.id],
      );
      expect(ids(await due(mod, 'scan'))).toEqual([mine.id, other.id].sort());
      expect(ids(await due(member, 'scan'))).toEqual([mine.id]);
      await sign(mod, other.id).expect(200);
      expect(ids(await due(mod, 'scan'))).toEqual([mine.id]);
    });
  });
});
