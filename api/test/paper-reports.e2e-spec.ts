import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { FaultReport } from '../src/faults/fault.entities';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeUser,
  PNG_1PX,
  resetDb,
  TestUser,
} from './helpers';

// Звіти (4.3а): звіт бере запис зі свого поля `ref:<тип>`, прив'язані поля
// показують запис (у чернетці — поля, після публікації — і зони), права —
// як у вільного документа, фіксується скільки завгодно.

type Paper = {
  id: string;
  status: string;
  content: Node;
  values: Record<string, unknown>;
  targetType: string | null;
  targetId: string | null;
  canFreeze: boolean;
  canPublish: boolean;
  refs: { type: string; id: string; title: string }[];
  snapshot: { n: number } | null;
  snapshots: { n: number }[];
};
type Node = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
};
type Field = Record<string, unknown> & { key: string };

const field = (key: string, over: Record<string, unknown> = {}): Field => ({
  key,
  label: key,
  type: 'text',
  required: false,
  fill: 'author',
  editable: false,
  print: true,
  ...over,
});
const line = (key: string): Node => ({
  type: 'paragraph',
  content: [{ type: 'field', attrs: { key } }],
});
const zone = (key: string): Node => ({
  type: 'fieldZone',
  attrs: { key },
  content: [{ type: 'paragraph' }],
});
const doc = (...content: Node[]) => ({ type: 'doc', content });

/** «Паспорт»: the equipment, its title and code, its description (a zone). */
const PASSPORT = [
  field('place', { type: 'ref:place', required: true }),
  field('title', { binding: 'title' }),
  field('code', { binding: 'code' }),
  field('about', { type: 'richtext', binding: 'description' }),
];
const PASSPORT_BODY = doc(
  line('place'),
  line('title'),
  line('code'),
  zone('about'),
);

/** All text of a document. */
const textOf = (n: Node): string =>
  (n.text ?? '') + (n.content ?? []).map(textOf).join('');

describe('Звіти (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let member2: TestUser;
  let placeId: string;

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
    // A signed scan goes to the archive: its category dictionary must exist.
    await category(app, 'document_category', 'Інше');
    const cat = await category(app, 'place_category', 'Верстати');
    placeId = (
      await as(app, admin)
        .post('/api/places')
        .send({
          code: 'CNC-1',
          title: 'Фрезер',
          category: cat,
          description: 'Тришпиндельний',
          needsAuthorization: false,
        })
        .expect(201)
    ).body.id;
  });

  const T = '/api/papers/templates';
  const code = (
    res: { status: number; body: { errorCode?: string; field?: string } },
    status: number,
    errorCode: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body.errorCode).toBe(errorCode);
  };
  /** A report template's draft version 1 with these fields and body. */
  const draftReport = async (
    target: string,
    fields: Field[],
    body: object,
    over: object = {},
  ) => {
    const t = (
      await as(app, mod)
        .post(T)
        .send({
          title: 'Звіт',
          kind: 'report',
          target,
          creators: 'all',
          visibility: 'members',
          ...over,
        })
        .expect(201)
    ).body as { id: string };
    await as(app, mod)
      .patch(`${T}/${t.id}/versions/1`)
      .send({ revision: 1, fields, body })
      .expect(200);
    return t.id;
  };
  const passport = async () => {
    const id = await draftReport('place', PASSPORT, PASSPORT_BODY);
    await as(app, mod).post(`${T}/${id}/versions/1/publish`).expect(201);
    return id;
  };
  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const newReport = async (u: TestUser, templateId: string, about = placeId) =>
    (
      await as(app, u)
        .post('/api/papers')
        .send({ templateId, about: { type: 'place', id: about } })
        .expect(201)
    ).body as Paper;

  describe('шаблон', () => {
    it('звіт — про типи, які модулі вміють читати', async () => {
      const res = await as(app, mod).get(`${T}/targets`).expect(200);
      expect(res.body.report).toEqual([
        'discipline_record',
        'fault',
        'place',
        'place_authorization',
        'points_entry',
        'task',
      ]);
      code(
        await as(app, mod)
          .post(T)
          .send({ title: 'Звіт', kind: 'report', target: 'project' }),
        400,
        'TEMPLATE_KIND_INVALID',
      );
    });

    it('без поля запису — TEMPLATE_REPORT_RECORD', async () => {
      const fields = PASSPORT.slice(1);
      const id = await draftReport(
        'place',
        fields,
        doc(line('title'), line('code'), zone('about')),
      );
      code(
        await as(app, mod).post(`${T}/${id}/versions/1/publish`),
        400,
        'TEMPLATE_REPORT_RECORD',
      );
    });

    it('поле запису необов’язкове чи «можна змінити» — TEMPLATE_FIELD_INVALID', async () => {
      for (const over of [{ required: false }, { editable: true }]) {
        const fields = [{ ...PASSPORT[0], ...over }, ...PASSPORT.slice(1)];
        const id = await draftReport('place', fields, PASSPORT_BODY);
        const res = await as(app, mod).post(`${T}/${id}/versions/1/publish`);
        code(res, 400, 'TEMPLATE_FIELD_INVALID');
        expect(res.body.field).toBe('place');
      }
    });

    it('прив’язане поле звіту обов’язкове — TEMPLATE_FIELD_INVALID', async () => {
      const fields = PASSPORT.map((f) =>
        f.key === 'title' ? { ...f, required: true } : f,
      );
      const id = await draftReport('place', fields, PASSPORT_BODY);
      const res = await as(app, mod).post(`${T}/${id}/versions/1/publish`);
      code(res, 400, 'TEMPLATE_FIELD_INVALID');
      expect(res.body.field).toBe('title');
    });

    it('звіт, опублікований без поля запису (до 4.3а), — «потребує оновлення»', async () => {
      const id = await passport();
      // As a version published before reports named their record.
      await ds.query(
        `UPDATE paper_template_versions SET fields = $2::jsonb, body = $3::jsonb WHERE template_id = $1`,
        [
          id,
          JSON.stringify(PASSPORT.slice(1)),
          JSON.stringify(doc(line('title'), line('code'), zone('about'))),
        ],
      );
      const list = (await as(app, mod).get(T).expect(200)).body as {
        id: string;
        needsUpdate: boolean;
      }[];
      expect(list.find((t) => t.id === id)?.needsUpdate).toBe(true);
      code(
        await as(app, member).post('/api/papers').send({ templateId: id }),
        409,
        'TEMPLATE_NEEDS_UPDATE',
      );
    });

    it('список шаблонів: звіт — про свій тип', async () => {
      await passport();
      const list = (await as(app, member).get(T).expect(200)).body as {
        kind: string;
        about: string[];
      }[];
      expect(list.find((t) => t.kind === 'report')?.about).toEqual(['place']);
    });
  });

  describe('документ', () => {
    it('чернетка показує запис у полях; авто-поле не заповнюється', async () => {
      const p = await newReport(member, await passport());
      expect(p.values).toMatchObject({
        place: placeId,
        title: 'Фрезер',
        code: 'CNC-1',
      });
      // The zone shows the record once published: the draft saves its text.
      expect(textOf(p.content)).not.toContain('Тришпиндельний');
      expect(p.refs).toEqual([
        expect.objectContaining({ type: 'place', id: placeId }),
      ]);
      // Only what the author fills is saved.
      const ok = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 1, values: { place: placeId } });
      expect(ok.status).toBe(200);
      const bad = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: 2, values: { place: placeId, title: 'Інше' } });
      code(bad, 400, 'PAPER_FIELD_INVALID');
      expect(bad.body.field).toBe('title');
    });

    it('опублікований — живий: запис змінився, звіт показує нове; запис не прив’язується як створений', async () => {
      const p = await newReport(member, await passport());
      await as(app, member).post(`/api/papers/${p.id}/publish`).expect(200);
      await as(app, admin)
        .patch(`/api/places/${placeId}`)
        .send({ title: 'Фрезер ЧПК', description: 'Новий опис' })
        .expect(200);
      const now = await get(member, p.id);
      expect(now).toMatchObject({
        status: 'published',
        targetType: null,
        targetId: null,
        values: { title: 'Фрезер ЧПК' },
      });
      expect(textOf(now.content)).toContain('Новий опис');
      // A report is not «the record's document».
      const links = await as(app, admin)
        .get('/api/links')
        .query({ type: 'place', id: placeId })
        .expect(200);
      expect(links.body.items).toEqual([
        expect.objectContaining({ type: 'paper', recordId: p.id }),
      ]);
    });

    it('запису вже немає — публікація PAPER_FIELD_INVALID з полем запису', async () => {
      const p = await newReport(member, await passport());
      await ds.query('DELETE FROM places WHERE id = $1', [placeId]);
      const res = await as(app, member).post(`/api/papers/${p.id}/publish`);
      code(res, 400, 'PAPER_FIELD_INVALID');
      expect(res.body.field).toBe('place');
    });

    it('права — як у вільного: учасник фіксує свій звіт, чужий — ні', async () => {
      const p = await newReport(member, await passport());
      await as(app, member).post(`/api/papers/${p.id}/publish`).expect(200);
      expect((await get(member2, p.id)).canFreeze).toBe(false);
      code(
        await as(app, member2).post(`/api/papers/${p.id}/freeze`),
        403,
        'NOT_OWNER',
      );
      expect((await get(member, p.id)).canFreeze).toBe(true);
      await as(app, member).post(`/api/papers/${p.id}/freeze`).expect(200);
    });
  });

  describe('повторна фіксація', () => {
    it('кожна фіксація — новий знімок зі свіжими даними; підписаний стає «Зафіксовано»', async () => {
      const p = await newReport(mod, await passport());
      await as(app, mod).post(`/api/papers/${p.id}/publish`).expect(200);
      const first = (
        await as(app, mod).post(`/api/papers/${p.id}/freeze`).expect(200)
      ).body as Paper;
      expect(first).toMatchObject({
        status: 'frozen',
        canFreeze: true,
        snapshot: { n: 1 },
        snapshots: [{ n: 1 }],
      });
      await as(app, admin)
        .patch(`/api/places/${placeId}`)
        .send({ title: 'Фрезер ЧПК' })
        .expect(200);
      // Frozen: what it showed stays.
      expect((await get(mod, p.id)).values.title).toBe('Фрезер');
      await as(app, mod)
        .post(`/api/papers/${p.id}/signed`)
        .attach('file', PNG_1PX, 'scan.png')
        .expect(200);
      const second = (
        await as(app, mod).post(`/api/papers/${p.id}/freeze`).expect(200)
      ).body as Paper;
      expect(second).toMatchObject({
        status: 'frozen',
        values: { title: 'Фрезер ЧПК' },
        snapshot: { n: 2 },
        snapshots: [{ n: 1 }, { n: 2 }],
      });
      const old = await as(app, mod).get(
        `/api/papers/${p.id}/print?snapshot=1`,
      );
      expect(old.status).toBe(200);
      expect(old.text).toContain('Фрезер<');
      expect(old.text).not.toContain('Фрезер ЧПК');
    });

    it('інший документ фіксується один раз', async () => {
      const p = (
        await as(app, member)
          .post('/api/papers')
          .send({ title: 'Нотатка', content: doc({ type: 'paragraph' }) })
          .expect(201)
      ).body as Paper;
      await as(app, member).post(`/api/papers/${p.id}/publish`).expect(200);
      await as(app, member).post(`/api/papers/${p.id}/freeze`).expect(200);
      expect((await get(member, p.id)).canFreeze).toBe(false);
      code(
        await as(app, member).post(`/api/papers/${p.id}/freeze`),
        409,
        'PAPER_FROZEN',
      );
    });
  });

  describe('несправність', () => {
    it('зв’язується й шукається; акт показує обладнання несправності', async () => {
      const fault = (
        await as(app, member)
          .post('/api/faults')
          .send({ placeId, description: 'Шпиндель шумить' })
          .expect(201)
      ).body as { id: string };
      const found = await as(app, member)
        .get('/api/links/candidates')
        .query({ type: 'fault', q: 'шпиндель' })
        .expect(200);
      expect(found.body).toEqual([
        expect.objectContaining({
          id: fault.id,
          title: expect.stringMatching(
            /^Несправність: Фрезер, \d\d\.\d\d\.\d{4}$/,
          ),
          archived: false,
        }),
      ]);
      const fields = [
        field('fault', { type: 'ref:fault', required: true }),
        field('where', { type: 'ref:place', binding: 'placeId' }),
        field('what', { binding: 'description' }),
      ];
      const id = await draftReport(
        'fault',
        fields,
        doc(line('fault'), line('where'), line('what')),
      );
      await as(app, mod).post(`${T}/${id}/versions/1/publish`).expect(201);
      const p = (
        await as(app, mod)
          .post('/api/papers')
          .send({ templateId: id, about: { type: 'fault', id: fault.id } })
          .expect(201)
      ).body as Paper;
      expect(p.values).toEqual({
        fault: fault.id,
        where: placeId,
        what: 'Шпиндель шумить',
      });
      expect(p.refs.map((r) => r.type).sort()).toEqual(['fault', 'place']);
      // Closed — shown as archived.
      await ds.getRepository(FaultReport).update(fault.id, {
        status: 'closed' as FaultReport['status'],
      });
      const closed = await as(app, member)
        .get('/api/links/candidates')
        .query({ type: 'fault', q: 'Фрезер' })
        .expect(200);
      expect(closed.body[0]).toMatchObject({ archived: true });
    });
  });
});
