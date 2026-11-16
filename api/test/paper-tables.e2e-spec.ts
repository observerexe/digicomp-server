import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  REPORT_TEMPLATES,
  ReportTemplates1819000000000,
} from '../src/migrations/1819000000000-ReportTemplates';
import { WorkSession } from '../src/places/work-session.entity';
import { PointsEntry, PointsKind } from '../src/points/points-entry.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  authorizationTemplates,
  category,
  createTestApp,
  grantByPaper,
  makeUser,
  resetDb,
  TestUser,
} from './helpers';

// Авто-таблиці (4.3б): рядки джерела для значення поля — живі для читача до
// фіксації, після неї — збережені в документі так, як їх бачив модератор.
// Шаблони «Паспорт обладнання», «Акт несправності», «Рейтинг за місяць» — з міграції.

type Table = {
  columns: string[];
  caption: string | null;
  rows: string[][] | null;
  more: number;
};
type Paper = {
  id: string;
  revision: number;
  status: string;
  values: Record<string, unknown>;
  tables: Record<string, Table>;
  canFreeze: boolean;
};

const [PASSPORT, ACT, RATING] = REPORT_TEMPLATES.map((t) => t.id) as [
  string,
  string,
  string,
];
const SESSIONS = 'place_sessions:place';
const AUTHS = 'place_authorizations:place';
const FAULTS = 'place_faults:place';

describe('Авто-таблиці (e2e)', () => {
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

  const session = (u: TestUser, startedAt: string) =>
    ds.getRepository(WorkSession).save({
      userId: u.id,
      placeId,
      startedAt: new Date(startedAt),
      endedAt: new Date(new Date(startedAt).getTime() + 90 * 60_000),
      safetyConfirmed: true,
    });

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, Role.Admin, { name: 'Адмін Перший' });
    mod = await makeUser(app, Role.Moderator, { name: 'Марта Модер' });
    member = await makeUser(app, Role.Member, { name: 'Олена Перша' });
    member2 = await makeUser(app, Role.Member, { name: 'Богдан Другий' });
    // The templates of the migration: its author is the first admin.
    const runner = ds.createQueryRunner();
    await new ReportTemplates1819000000000().up(runner);
    await runner.release();
    const cat = await category(app, 'place_category', 'Принтери');
    placeId = (
      await as(app, admin)
        .post('/api/places')
        .send({ code: 'PRN-1', title: 'Принтер', category: cat })
        .expect(201)
    ).body.id;
    const briefing = await authorizationTemplates(app);
    for (const u of [member, member2]) {
      const granted = await grantByPaper(app, mod, briefing, {
        userId: u.id,
        placeId,
        note: `допуск ${u.name}`,
      });
      expect(granted.status).toBe(200);
    }
    await session(member, '2026-10-01T08:00:00Z');
    await session(member2, '2026-10-02T08:00:00Z');
    await as(app, member)
      .post('/api/faults')
      .send({ placeId, description: 'Засмічене сопло' })
      .expect(201);
  });

  const get = async (u: TestUser, id: string) =>
    (await as(app, u).get(`/api/papers/${id}`).expect(200)).body as Paper;
  const create = async (u: TestUser, templateId: string, about?: object) =>
    (
      await as(app, u)
        .post('/api/papers')
        .send({ templateId, ...(about ? { about } : {}) })
        .expect(201)
    ).body as Paper;
  const names = (t: Table | undefined, col = 0) =>
    (t?.rows ?? []).map((r) => r[col]);

  it('джерела — у списку для конструктора', async () => {
    const res = await as(app, mod)
      .get('/api/papers/templates/targets')
      .expect(200);
    expect(
      (res.body.tables as { key: string; input: string }[]).map((s) => [
        s.key,
        s.input,
      ]),
    ).toEqual([
      ['place_authorizations', 'ref:place'],
      ['place_faults', 'ref:place'],
      ['place_sessions', 'ref:place'],
      ['points_month', 'date'],
      ['project_materials', 'ref:project'],
      ['project_tasks', 'ref:project'],
    ]);
  });

  describe('«Паспорт обладнання»', () => {
    const passport = async () => {
      const p = await create(mod, PASSPORT, { type: 'place', id: placeId });
      // Seen by everyone once published: a member reads it as members may.
      await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, visibility: 'members' })
        .expect(200);
      await as(app, mod).post(`/api/papers/${p.id}/publish`).expect(200);
      return p.id;
    };

    it('чернетка вже показує таблиці запису', async () => {
      const p = await create(mod, PASSPORT, { type: 'place', id: placeId });
      expect(p.tables[SESSIONS]?.columns).toEqual([
        'Учасник',
        'Початок',
        'Кінець',
        'Тривалість',
        'Примітка',
      ]);
      // Oldest first; 90 minutes — «1:30».
      expect(p.tables[SESSIONS]?.rows).toEqual([
        ['Олена Перша', '01.10.2026, 11:00', '01.10.2026, 12:30', '1:30', ''],
        ['Богдан Другий', '02.10.2026, 11:00', '02.10.2026, 12:30', '1:30', ''],
      ]);
      expect(names(p.tables[AUTHS]).sort()).toEqual([
        'Богдан Другий',
        'Олена Перша',
      ]);
      expect(p.tables[AUTHS]?.rows?.[0]?.[2]).toBe('безстроково');
      expect(names(p.tables[FAULTS], 1)).toEqual(['Засмічене сопло']);
    });

    it('живі таблиці — за правилом джерела: учасник бачить свої сеанси й допуски, несправності — усі', async () => {
      const id = await passport();
      const p = await get(member, id);
      expect(names(p.tables[SESSIONS])).toEqual(['Олена Перша']);
      expect(names(p.tables[AUTHS])).toEqual(['Олена Перша']);
      expect(names(p.tables[FAULTS], 1)).toEqual(['Засмічене сопло']);
      expect(names((await get(mod, id)).tables[SESSIONS])).toHaveLength(2);
    });

    it('після фіксації — як бачив модератор, нові дані не потрапляють; нова версія звіту — свіжі', async () => {
      const id = await passport();
      await as(app, mod).post(`/api/papers/${id}/freeze`).expect(200);
      await session(member2, '2026-10-03T08:00:00Z');
      const frozen = await get(member, id);
      expect(frozen.status).toBe('frozen');
      expect(names(frozen.tables[SESSIONS])).toEqual([
        'Олена Перша',
        'Богдан Другий',
      ]);
      const print = await as(app, member)
        .get(`/api/papers/${id}/print`)
        .expect(200);
      expect(print.text).toContain('Богдан Другий');
      expect(print.text).toContain('class="paper-table"');

      await as(app, mod).post(`/api/papers/${id}/freeze`).expect(200);
      expect(names((await get(member, id)).tables[SESSIONS])).toHaveLength(3);
      const second = await as(app, mod)
        .get(`/api/papers/${id}/print?snapshot=2`)
        .expect(200);
      // The session of 03.10 is in the second snapshot only.
      expect(second.text).toContain('03.10.2026');
      expect(print.text).not.toContain('03.10.2026');
    });
  });

  it('«Акт несправності»: звіт про несправність показує її поля', async () => {
    const [fault] = (await ds.query(`SELECT id FROM fault_reports`)) as {
      id: string;
    }[];
    const p = await create(mod, ACT, { type: 'fault', id: fault!.id });
    expect(p.values).toMatchObject({
      fault: fault!.id,
      place: placeId,
      reporter: member.id,
      description: 'Засмічене сопло',
      status: 'open',
    });
    expect(p.tables).toEqual({});
  });

  describe('«Рейтинг за місяць»', () => {
    beforeEach(async () => {
      const repo = ds.getRepository(PointsEntry);
      for (const [u, amount, at] of [
        [member, 10, '2026-10-15T12:00:00'],
        [member2, 4, '2026-10-20T12:00:00'],
        [member2, 50, '2026-11-02T12:00:00'],
      ] as const) {
        await repo.save({
          userId: u.id,
          amount,
          kind: PointsKind.Manual,
          reason: 'за роботу',
          createdById: mod.id,
          createdAt: new Date(at),
        });
      }
    });

    it('поле порожнє — рядків ще немає; дата — рейтинг її місяця з підписом місяця', async () => {
      const p = await create(mod, RATING);
      const key = 'points_month:month';
      expect(p.tables[key]).toEqual({
        columns: ['Місце', 'Учасник', 'Бали'],
        caption: null,
        rows: null,
        more: 0,
      });
      // The answer to PATCH carries no content: the document is read again.
      await as(app, mod)
        .patch(`/api/papers/${p.id}`)
        .send({ revision: p.revision, values: { month: '2026-10-03' } })
        .expect(200);
      const saved = await get(mod, p.id);
      expect(saved.tables[key]?.caption).toBe('Жовтень 2026');
      const rows = saved.tables[key]!.rows!;
      expect(rows.slice(0, 2)).toEqual([
        ['1', 'Олена Перша', '10'],
        ['2', 'Богдан Другий', '4'],
      ]);
      // Every active member is ranked, with 0 too.
      expect(rows.map((r) => r[1])).toContain('Марта Модер');
    });
  });

  describe('перевірки', () => {
    const T = '/api/papers/templates';
    const draft = async (source: string, type: string) => {
      const t = (
        await as(app, mod)
          .post(T)
          .send({ title: 'Таблиця', kind: 'free', creators: 'staff' })
          .expect(201)
      ).body as { id: string };
      await as(app, mod)
        .patch(`${T}/${t.id}/versions/1`)
        .send({
          revision: 1,
          fields: [
            {
              key: 'x',
              label: 'X',
              type,
              required: true,
              fill: 'author',
              editable: false,
              print: true,
            },
          ],
          body: {
            type: 'doc',
            content: [{ type: 'autoTable', attrs: { source, field: 'x' } }],
          },
        })
        .expect(200);
      return as(app, mod).post(`${T}/${t.id}/versions/1/publish`);
    };

    it('невідоме джерело чи поле не того типу — TEMPLATE_FIELD_INVALID', async () => {
      for (const [source, type] of [
        ['nowhere', 'date'],
        ['points_month', 'text'],
      ]) {
        const res = await draft(source!, type!);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          errorCode: 'TEMPLATE_FIELD_INVALID',
          field: 'x',
        });
      }
      await draft('points_month', 'date').then((r) =>
        expect(r.status).toBe(201),
      );
    });

    it('у вільному документі без шаблону авто-таблиці немає — PAPER_CONTENT_LOCKED', async () => {
      const p = (await as(app, member).post('/api/papers').send({}).expect(201))
        .body as Paper;
      const res = await as(app, member)
        .patch(`/api/papers/${p.id}`)
        .send({
          revision: p.revision,
          content: {
            type: 'doc',
            content: [
              {
                type: 'autoTable',
                attrs: { source: 'points_month', field: 'x' },
              },
            ],
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PAPER_CONTENT_LOCKED');
    });
  });
});
