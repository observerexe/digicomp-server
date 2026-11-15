import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  disciplineTemplates,
  issueRecord,
  makeUser,
  oldAward,
  pointsTemplates,
  publishSheet,
  resetDb,
  TestUser,
} from './helpers';

// Старі записи й навігація (3.4): документ для стягнення й ручного
// нарахування, зроблених до документів (`POST /papers/for-record`), — від
// того, хто може їх зняти, лише для чинних; фільтри списку документів
// `status` і `about=me` (Головна).

type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Res = { status: number; body: Record<string, any> };

const YEAR = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
}).format(new Date());

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

/** Text of the zone `key`: its paragraphs, one per line. */
function zoneText(n: Node, key: string): string | null {
  if (n.type === 'fieldZone' && n.attrs?.key === key) {
    return (n.content ?? [])
      .map((p) => (p.content ?? []).map((t) => t.text ?? '').join(''))
      .join('\n');
  }
  for (const c of n.content ?? []) {
    const t = zoneText(c, key);
    if (t !== null) return t;
  }
  return null;
}

describe('Документи для старих записів (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let mod2: TestUser;
  let a: TestUser;
  let b: TestUser;

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
    mod2 = await makeUser(app, Role.Moderator);
    a = await makeUser(app, Role.Member);
    b = await makeUser(app, Role.Member);
  });

  const forRecord = (u: TestUser, templateId: string, targetId: string) =>
    as(app, u).post('/api/papers/for-record').send({ templateId, targetId });
  const balance = async (u: TestUser) =>
    (await as(app, u).get('/api/points/me')).body.balance as number;

  describe('стягнення', () => {
    let issue: string;
    beforeEach(async () => {
      issue = (await disciplineTemplates(app)).issue;
    });

    const old = async (by: TestUser, dto: Record<string, unknown>) => {
      const res = await issueRecord(app, by, dto);
      expect(res.status).toBe(200);
      return res.body.id as string;
    };

    it('«Подання» з поточних значень, одразу опубліковане, з номером і зв’язком; аудит', async () => {
      await oldAward(app, admin, a, 10);
      const id = await old(mod, {
        userId: a.id,
        type: 'fine',
        amount: 4,
        reason: 'не вимкнув станцію',
      });
      const res = await forRecord(mod, issue, id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'published',
        number: `ПС-${YEAR}-001`,
        targetType: 'discipline_record',
        targetId: id,
        values: { userId: a.id, type: 'fine', amount: 4 },
      });
      expect(zoneText(res.body.content as Node, 'reason')).toBe(
        'не вимкнув станцію',
      );
      // Штраф знято раніше не було: бали не змінились.
      expect(await balance(a)).toBe(6);

      const [log] = await ds
        .getRepository(AuditLog)
        .findBy({ action: 'paper.published' });
      expect(log!.meta).toMatchObject({
        targetType: 'discipline_record',
        targetId: id,
        fromRecord: true,
      });

      // Запис знає своє подання; учасник його бачить.
      const mine = await as(app, a).get('/api/discipline/me');
      expect(mine.body[0].paper).toEqual({
        id: res.body.id,
        number: `ПС-${YEAR}-001`,
      });
      expect((await as(app, a).get(`/api/papers/${res.body.id}`)).status).toBe(
        200,
      );

      // Другий документ — ні; зняти тепер лише скасуванням документа.
      code(await forRecord(admin, issue, id), 409, 'PAPER_TARGET_TAKEN');
      code(
        await as(app, mod)
          .post(`/api/discipline/${id}/revoke`)
          .send({ reason: 'x' }),
        409,
        'DISCIPLINE_HAS_PAPER',
      );
      const cancelled = await as(app, mod)
        .post(`/api/papers/${res.body.id}/cancel`)
        .send({ reason: 'помилка' });
      expect(cancelled.status).toBe(200);
      expect(await balance(a)).toBe(10);
    });

    it('попередження: розміру штрафу немає', async () => {
      const id = await old(mod, { userId: a.id, type: 'warning', reason: 'r' });
      const res = await forRecord(mod, issue, id);
      expect(res.status).toBe(201);
      expect(res.body.values).toEqual({ userId: a.id, type: 'warning' });
    });

    it('хто може зняти: адмін — будь-яке, модератор — видане собою; учасникові шаблон не видно', async () => {
      const id = await old(mod, { userId: a.id, type: 'warning', reason: 'r' });
      code(await forRecord(mod2, issue, id), 403, 'NOT_OWNER');
      // Шаблон «Подання» учасникові не видно.
      expect((await forRecord(a, issue, id)).status).toBe(404);
      expect((await forRecord(admin, issue, id)).status).toBe(201);
      // Відмова нічого не лишила: номер не витрачено, документ один.
      const papers = await ds.query<{ number: string }[]>(
        `SELECT number FROM papers`,
      );
      expect(papers).toEqual([{ number: `ПС-${YEAR}-001` }]);
    });

    it('зняте стягнення документа не отримує', async () => {
      const id = await old(mod, { userId: a.id, type: 'warning', reason: 'r' });
      await as(app, mod)
        .post(`/api/discipline/${id}/revoke`)
        .send({ reason: 'x' })
        .expect(200);
      code(await forRecord(mod, issue, id), 409, 'ALREADY_REVOKED');
      expect(await ds.query(`SELECT id FROM papers`)).toEqual([]);
    });
  });

  describe('бали', () => {
    let sheet: string;
    beforeEach(async () => {
      sheet = await pointsTemplates(app);
    });

    it('«Відомість балів» з одним рядком; нарахування посилається на неї; скасування знімає', async () => {
      const entry = await oldAward(app, mod, a, 5, 'чергування');
      const res = await forRecord(mod, sheet, entry.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'published',
        number: `ВБ-${YEAR}-001`,
        targetType: 'points_entry',
        targetId: null,
        values: { awards: [{ member: a.id, amount: 5, reason: 'чергування' }] },
      });
      const [row] = await ds.query<{ paper_id: string }[]>(
        `SELECT paper_id FROM points_ledger WHERE id = $1`,
        [entry.id],
      );
      expect(row!.paper_id).toBe(res.body.id);
      const [log] = await ds
        .getRepository(AuditLog)
        .findBy({ action: 'paper.published' });
      expect(log!.meta).toMatchObject({
        targetType: 'points_entry',
        targetIds: [entry.id],
        fromRecord: true,
      });

      // Учасник бачить відомість і посилання в історії.
      const me = await as(app, a).get('/api/points/me');
      expect(me.body.history[0].paper).toEqual({
        id: res.body.id,
        number: `ВБ-${YEAR}-001`,
      });
      expect((await as(app, a).get(`/api/papers/${res.body.id}`)).status).toBe(
        200,
      );

      code(await forRecord(mod, sheet, entry.id), 409, 'PAPER_TARGET_TAKEN');
      code(
        await as(app, mod)
          .post(`/api/points/${entry.id}/revoke`)
          .send({ reason: 'x' }),
        409,
        'POINTS_HAS_PAPER',
      );
      await as(app, mod)
        .post(`/api/papers/${res.body.id}/cancel`)
        .send({ reason: 'помилка' })
        .expect(200);
      expect(await balance(a)).toBe(0);
    });

    it('хто може зняти: адмін — будь-яке, модератор — своє; учасникові шаблон не видно', async () => {
      const entry = await oldAward(app, mod, a, 5);
      code(await forRecord(mod2, sheet, entry.id), 403, 'NOT_OWNER');
      expect((await forRecord(b, sheet, entry.id)).status).toBe(404);
      expect((await forRecord(admin, sheet, entry.id)).status).toBe(201);
    });

    it('лише чинне ручне нарахування; з відомості — уже має документ', async () => {
      const revoked = await oldAward(app, mod, a, 5);
      await as(app, mod)
        .post(`/api/points/${revoked.id}/revoke`)
        .send({ reason: 'x' })
        .expect(200);
      code(await forRecord(mod, sheet, revoked.id), 409, 'ALREADY_REVOKED');
      const [reversal] = await ds.query<{ id: string }[]>(
        `SELECT id FROM points_ledger WHERE reverses_id = $1`,
        [revoked.id],
      );
      code(
        await forRecord(admin, sheet, reversal!.id),
        409,
        'ENTRY_NOT_REVOCABLE',
      );

      const p = await publishSheet(app, mod, sheet, [
        { member: b.id, amount: 3, reason: 'r' },
      ]);
      const [fromSheet] = await ds.query<{ id: string }[]>(
        `SELECT id FROM points_ledger WHERE paper_id = $1`,
        [p.body.id],
      );
      code(
        await forRecord(admin, sheet, fromSheet!.id),
        409,
        'PAPER_TARGET_TAKEN',
      );
      // Нарахування лишилося при своїй відомості.
      const [kept] = await ds.query<{ paper_id: string }[]>(
        `SELECT paper_id FROM points_ledger WHERE id = $1`,
        [fromSheet!.id],
      );
      expect(kept!.paper_id).toBe(p.body.id);
    });
  });

  describe('список документів: стан і «про мене»', () => {
    const list = (u: TestUser, query: Record<string, string>) =>
      as(app, u).get('/api/papers').query(query);
    const ids = (res: Res) =>
      (res.body.items as { id: string }[]).map((i) => i.id);

    it('status=draft — лише чернетки', async () => {
      const draft = await as(app, a).post('/api/papers').send({ title: 'Ч' });
      const done = await as(app, a).post('/api/papers').send({ title: 'О' });
      await as(app, a).post(`/api/papers/${done.body.id}/publish`).expect(200);
      expect(ids(await list(a, { mine: 'true', status: 'draft' }))).toEqual([
        draft.body.id,
      ]);
      code(await list(a, { status: 'nope' }), 400, 'VALIDATION_ERROR');
    });

    it('about=me — опубліковані чужі, що посилаються на мене, які я бачу', async () => {
      const sheet = await pointsTemplates(app);
      const { issue } = await disciplineTemplates(app);
      // Відомість з рядком про a — a бачить її.
      const awarded = await publishSheet(app, mod, sheet, [
        { member: a.id, amount: 2, reason: 'r' },
      ]);
      // Подання про b — a його не бачить і воно не про a.
      const old = await issueRecord(app, mod, {
        userId: b.id,
        type: 'warning',
        reason: 'r',
      });
      await forRecord(mod, issue, old.body.id).expect(201);
      // Чернетка відомості з a — ще не новина.
      const draft = await as(app, mod)
        .post('/api/papers')
        .send({ templateId: sheet });
      await as(app, mod)
        .patch(`/api/papers/${draft.body.id}`)
        .send({
          revision: draft.body.revision,
          values: { awards: [{ member: a.id, amount: 1, reason: 'r' }] },
        })
        .expect(200);

      expect(ids(await list(a, { about: 'me' }))).toEqual([awarded.body.id]);
      expect(ids(await list(b, { about: 'me' }))).toHaveLength(1);
      // Власні документи — не «про мене».
      expect(ids(await list(mod, { about: 'me' }))).toEqual([]);
    });
  });
});
