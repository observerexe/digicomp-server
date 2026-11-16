import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { PaperSignature } from '../src/paperwork/paper-signature.entity';
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
} from './helpers';

// Графічний підпис (6.5а): зафіксований знімок пам'ятає, кого чекає кожна
// лінія підпису; людина малює підпис — він стає на всі її лінії; усі лінії
// з людьми підписані — «Підписано». Знімок і його хеш не змінюються.

type Line = {
  row: number;
  label: string;
  person: { id: string; name: string } | null;
  signedAt: string | null;
  strokes: number[][] | null;
};

type Paper = {
  id: string;
  status: string;
  revision: number;
  targetId: string | null;
  canSignDrawn: boolean;
  snapshot: { n: number; sha256: string; signatures: Line[] } | null;
};

const STROKES = [
  [10, 400, 200, 100, 400, 380, 700, 120],
  [900, 250],
];

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const para = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
/** «Затверджую», author and org signer, a line naming nobody. */
const SHEET = doc(
  { type: 'approval' },
  para('Протокол'),
  {
    type: 'signatures',
    attrs: {
      leftLabel: 'Склав',
      rightLabel: 'Погодив',
      rightSigner: '@signer',
    },
  },
  {
    type: 'signatures',
    attrs: { leftLabel: 'Ознайомлений', leftSigner: null },
  },
);

describe('Графічний підпис (e2e)', () => {
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
    await category(app, 'document_category', 'Накази');
    await as(app, admin)
      .patch('/api/org-settings')
      .send({ signerId: mod.id })
      .expect(200);
  });

  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const signDrawn = (u: TestUser, id: string, strokes: unknown = STROKES) =>
    as(app, u).post(`/api/papers/${id}/signatures`).send({ strokes });
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
  const due = async (u: TestUser) =>
    (
      (await as(app, u).get('/api/papers?due=sign').expect(200)).body as {
        items: { id: string }[];
      }
    ).items.map((x) => x.id);

  /** A free document of `u`, published (visible to all) and frozen if `frozen`. */
  const freePaper = async (u: TestUser, content = SHEET, frozen = true) => {
    const p = (
      await as(app, u)
        .post('/api/papers')
        .send({ title: 'Протокол', content })
        .expect(201)
    ).body as Paper;
    await as(app, u).post(`/api/papers/${p.id}/publish`).expect(200);
    if (frozen) await as(app, u).post(`/api/papers/${p.id}/freeze`).expect(200);
    return get(u, p.id);
  };
  const share = async (id: string) => {
    const { revision } = await get(admin, id);
    await as(app, admin)
      .patch(`/api/papers/${id}`)
      .send({ revision, visibility: 'members' })
      .expect(200);
  };

  describe('лінії знімка', () => {
    it('фіксація записує, кого чекає кожна лінія; зміна «Реквізитів» потім підписанта не міняє', async () => {
      const p = await freePaper(member);
      expect(p.snapshot!.signatures).toEqual([
        {
          row: 0,
          label: 'Затверджую',
          person: { id: mod.id, name: mod.name },
          signedAt: null,
          strokes: null,
        },
        {
          row: 1,
          label: 'Склав',
          person: { id: member.id, name: member.name },
          signedAt: null,
          strokes: null,
        },
        {
          row: 2,
          label: 'Погодив',
          person: { id: mod.id, name: mod.name },
          signedAt: null,
          strokes: null,
        },
        {
          row: 3,
          label: 'Ознайомлений',
          person: null,
          signedAt: null,
          strokes: null,
        },
      ]);
      expect(p.canSignDrawn).toBe(true);
      expect((await get(mod, p.id)).canSignDrawn).toBe(true);
      expect((await get(admin, p.id)).canSignDrawn).toBe(false);

      await as(app, admin)
        .patch('/api/org-settings')
        .send({ signerId: admin.id })
        .expect(200);
      expect((await get(mod, p.id)).canSignDrawn).toBe(true);
      code(await signDrawn(admin, p.id), 403, 'NOT_SIGNER');
      await signDrawn(mod, p.id).expect(200);
    });

    it('без підписанта в «Реквізитах» «Затверджую» — лише скан', async () => {
      await as(app, admin)
        .patch('/api/org-settings')
        .send({ signerId: null })
        .expect(200);
      const p = await freePaper(member, doc({ type: 'approval' }, para('a')));
      expect(p.snapshot!.signatures).toEqual([
        {
          row: 0,
          label: 'Затверджую',
          person: null,
          signedAt: null,
          strokes: null,
        },
      ]);
      expect(p.canSignDrawn).toBe(false);
    });
  });

  describe('підписання', () => {
    it('один натиск — усі свої лінії; останній підпис — «Підписано»; аудит; знімок незмінний', async () => {
      const p = await freePaper(member);
      const [before] = await ds
        .getRepository(PaperSnapshot)
        .findBy({ paperId: p.id });

      const byMod = (await signDrawn(mod, p.id).expect(200)).body as Paper;
      expect(byMod).toMatchObject({
        status: 'frozen',
        revision: p.revision + 1,
        canSignDrawn: false,
      });
      const signed = byMod.snapshot!.signatures.filter((l) => l.signedAt);
      expect(signed.map((l) => l.row)).toEqual([0, 2]);
      // The editor draws them over their lines: the strokes come with the document.
      expect(signed.map((l) => l.strokes)).toEqual([STROKES, STROKES]);
      expect(
        byMod
          .snapshot!.signatures.filter((l) => !l.signedAt)
          .map((l) => l.strokes),
      ).toEqual([null, null]);
      code(await signDrawn(mod, p.id), 409, 'PAPER_SIGNED_BY_YOU');
      code(await signDrawn(admin, p.id), 403, 'NOT_SIGNER');

      const done = (await signDrawn(member, p.id).expect(200)).body as Paper;
      expect(done.status).toBe('signed');
      expect(done.snapshot!.signatures.map((l) => !!l.signedAt)).toEqual([
        true,
        true,
        true,
        false,
      ]);

      const rows = await ds
        .getRepository(PaperSignature)
        .find({ order: { row: 'ASC' } });
      expect(rows.map((r) => [r.row, r.userId])).toEqual([
        [0, mod.id],
        [1, member.id],
        [2, mod.id],
      ]);
      expect(rows[0]!.strokes).toEqual(STROKES);
      const [after] = await ds
        .getRepository(PaperSnapshot)
        .findBy({ paperId: p.id });
      expect(after!.html).toBe(before!.html);
      expect(after!.sha256).toBe(before!.sha256);

      const log = await audit('paper.signature_added');
      expect(log.map((l) => [l.actorId, l.meta])).toEqual(
        expect.arrayContaining([
          [
            mod.id,
            expect.objectContaining({
              n: 1,
              lines: ['Затверджую', 'Погодив'],
              complete: false,
            }),
          ],
          [
            member.id,
            expect.objectContaining({ lines: ['Склав'], complete: true }),
          ],
        ]),
      );
      expect(log).toHaveLength(2);
    });

    it('не зафіксований — PAPER_NOT_FROZEN: чернетка, опублікований, скасований', async () => {
      const draft = (
        await as(app, member)
          .post('/api/papers')
          .send({ title: 'Чернетка', content: SHEET })
          .expect(201)
      ).body as Paper;
      code(await signDrawn(member, draft.id), 409, 'PAPER_NOT_FROZEN');
      const published = await freePaper(member, SHEET, false);
      code(await signDrawn(member, published.id), 409, 'PAPER_NOT_FROZEN');
      const cancelled = await freePaper(member);
      await as(app, member)
        .post(`/api/papers/${cancelled.id}/cancel`)
        .send({ reason: 'Помилка' })
        .expect(200);
      code(await signDrawn(member, cancelled.id), 409, 'PAPER_NOT_FROZEN');
      expect((await get(member, cancelled.id)).canSignDrawn).toBe(false);
    });

    it('штрихи поза межами — VALIDATION_ERROR; нічого не записано', async () => {
      const p = await freePaper(member);
      for (const strokes of [null, [], [[1501, 0]], [[1, 2, 3]], '<svg/>']) {
        code(await signDrawn(member, p.id, strokes), 400, 'VALIDATION_ERROR');
      }
      expect(await ds.getRepository(PaperSignature).count()).toBe(0);
    });

    it('невидимий документ — 404', async () => {
      const p = await freePaper(member);
      const res = await signDrawn(member2, p.id);
      expect(res.status).toBe(404);
    });

    it('після скану підписати графічно можна; стан лишається «Підписано»', async () => {
      const p = await freePaper(member);
      await as(app, member)
        .post(`/api/papers/${p.id}/signed`)
        .attach('file', PNG_1PX, 'scan.png')
        .expect(200);
      const res = (await signDrawn(member, p.id).expect(200)).body as Paper;
      expect(res.status).toBe('signed');
    });

    it('знімок до 6.5а (без ліній) — лише скан', async () => {
      const p = await freePaper(member);
      await ds.query(
        `UPDATE paper_snapshots SET signers = NULL WHERE paper_id = $1`,
        [p.id],
      );
      const now = await get(member, p.id);
      expect(now.snapshot!.signatures).toEqual([]);
      expect(now.canSignDrawn).toBe(false);
      code(await signDrawn(member, p.id), 403, 'NOT_SIGNER');
      expect(await due(member)).toEqual([]);
    });
  });

  describe('друк, DOCX, перевірка', () => {
    it('друк: малюнок на своїй лінії й «Підписано в DigiComp HUB»; DOCX — з іменем; перевірка — хто й коли', async () => {
      const p = await freePaper(member);
      await signDrawn(member, p.id).expect(200);

      const print = await as(app, member).get(`/api/papers/${p.id}/print`);
      expect(print.status).toBe(200);
      expect(print.text.match(/<svg class="paper-signature"/g)).toHaveLength(1);
      expect(print.text).toMatch(
        /<p class="paper-signed-note">Підписано в DigiComp HUB \d\d\.\d\d\.\d{4}, \d\d:\d\d<\/p>/,
      );
      expect(print.text).not.toMatch(/<[^>]+\sstyle=/);

      const docx = await as(app, member)
        .get(`/api/papers/${p.id}/docx`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(docx.status).toBe(200);
      const { strFromU8, unzipSync } = await import('fflate');
      const xml = strFromU8(
        unzipSync(new Uint8Array(docx.body as Buffer))['word/document.xml']!,
      );
      expect(xml).toContain(`Підписано в DigiComp HUB: ${member.name}, `);

      const check = await as(app, member2)
        .get(`/api/papers/verify/${p.snapshot!.sha256}`)
        .expect(200);
      expect(check.body.signatures).toEqual([
        { label: 'Затверджую', name: mod.name, signedAt: null },
        { label: 'Склав', name: member.name, signedAt: expect.any(String) },
        { label: 'Погодив', name: mod.name, signedAt: null },
      ]);
    });
  });

  describe('«На мій підпис»', () => {
    it('зафіксовані, де мене чекає непідписана лінія останнього знімка', async () => {
      const p = await freePaper(member);
      const other = await freePaper(member2, doc(para('a')));
      await share(p.id);
      await share(other.id);
      expect(await due(member)).toEqual([p.id]);
      expect(await due(mod)).toEqual([p.id]);
      expect(await due(admin)).toEqual([]);
      await signDrawn(mod, p.id).expect(200);
      expect(await due(mod)).toEqual([]);
      expect(await due(member)).toEqual([p.id]);
    });

    it('ТЗ: «Роботу прийняв» — той, хто прийняв; «Завдання видав» — автор', async () => {
      const { full } = await taskTemplates(app);
      const res = await publishTaskPaper(app, mod, full);
      const { id, targetId: task } = res.body as Paper;
      await as(app, member).post(`/api/tasks/${task}/take`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/start`).expect(200);
      await as(app, member).post(`/api/tasks/${task}/submit`).expect(200);
      await as(app, admin).post(`/api/tasks/${task}/accept`).expect(200);

      const p = await get(admin, id);
      expect(p.status).toBe('frozen');
      expect(
        p.snapshot!.signatures.map((l) => [l.label, l.person?.id ?? null]),
      ).toEqual([
        ['Затверджую', mod.id],
        ['Завдання видав', mod.id],
        ['Роботу прийняв', admin.id],
      ]);
      expect(p.canSignDrawn).toBe(true);
      expect(await due(admin)).toEqual([id]);
      await signDrawn(admin, id).expect(200);
      expect(await due(admin)).toEqual([]);
      const done = (await signDrawn(mod, id).expect(200)).body as Paper;
      expect(done.status).toBe('signed');
    });
  });

  describe('звіт', () => {
    it('нова фіксація — нові лінії; підписи старого знімка лишаються при ньому', async () => {
      const cat = await category(app, 'place_category', 'Верстати');
      const placeId = (
        await as(app, admin)
          .post('/api/places')
          .send({
            code: 'CNC-1',
            title: 'Фрезер',
            category: cat,
            description: 'Опис',
            needsAuthorization: false,
          })
          .expect(201)
      ).body.id as string;
      const T = '/api/papers/templates';
      const t = (
        await as(app, mod)
          .post(T)
          .send({
            title: 'Звіт',
            kind: 'report',
            target: 'place',
            creators: 'all',
            visibility: 'members',
          })
          .expect(201)
      ).body as { id: string };
      await as(app, mod)
        .patch(`${T}/${t.id}/versions/1`)
        .send({
          revision: 1,
          fields: [
            {
              key: 'place',
              label: 'Обладнання',
              type: 'ref:place',
              required: true,
              fill: 'author',
              editable: false,
              print: true,
            },
          ],
          body: doc(
            {
              type: 'paragraph',
              content: [{ type: 'field', attrs: { key: 'place' } }],
            },
            { type: 'signatures', attrs: { leftLabel: 'Склав' } },
          ),
        })
        .expect(200);
      await as(app, mod).post(`${T}/${t.id}/versions/1/publish`).expect(201);
      const p = (
        await as(app, mod)
          .post('/api/papers')
          .send({ templateId: t.id, about: { type: 'place', id: placeId } })
          .expect(201)
      ).body as Paper;
      await as(app, mod).post(`/api/papers/${p.id}/publish`).expect(200);
      await as(app, mod).post(`/api/papers/${p.id}/freeze`).expect(200);
      expect(
        ((await signDrawn(mod, p.id).expect(200)).body as Paper).status,
      ).toBe('signed');

      const second = (
        await as(app, mod).post(`/api/papers/${p.id}/freeze`).expect(200)
      ).body as Paper;
      expect(second).toMatchObject({ status: 'frozen', canSignDrawn: true });
      expect(second.snapshot).toMatchObject({
        n: 2,
        signatures: [{ row: 0, label: 'Склав', signedAt: null }],
      });
      const old = await as(app, mod).get(
        `/api/papers/${p.id}/print?snapshot=1`,
      );
      expect(old.text).toContain('<svg class="paper-signature"');
      const now = await as(app, mod).get(`/api/papers/${p.id}/print`);
      expect(now.text).not.toContain('<svg class="paper-signature"');
      await signDrawn(mod, p.id).expect(200);
    });
  });
});
