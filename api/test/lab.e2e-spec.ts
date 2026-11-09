import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { WorkSessionsService } from '../src/places/work-sessions.service';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  PNG_1PX,
  resetDb,
  TestUser,
} from './helpers';

// Етап 3: бронювання, захист чужого слоту, автозакриття сеансів,
// вивантаження журналу (CSV і сторінка для друку), несправності, етапи проєктів.

type Res = { status: number; body: Record<string, any> };

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('Лабораторія і проєкти (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let a: TestUser;
  let b: TestUser;
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
    mod = await makeUser(app, Role.Moderator, { name: 'Модератор' });
    a = await makeUser(app, Role.Member, { name: 'Андрій' });
    b = await makeUser(app, Role.Member, { name: 'Богдана' });
    const p = await as(app, admin).post('/api/places').send({
      code: 'CNC-1',
      title: 'Фрезер',
      category: 'Верстати',
      needsAuthorization: false,
    });
    placeId = p.body.id;
  });

  const book = (u: TestUser, startMs: number, endMs: number, over = {}) =>
    as(app, u)
      .post('/api/bookings')
      .send({ placeId, startsAt: iso(startMs), endsAt: iso(endMs), ...over });
  const start = (u: TestUser) =>
    as(app, u)
      .post(`/api/places/${placeId}/sessions`)
      .send({ safetyConfirmed: true });

  describe('бронювання', () => {
    it('без перетинів; суміжні слоти можна', async () => {
      const t = Date.now() + 24 * H;
      expect((await book(a, t, t + 2 * H)).status).toBe(201);
      code(await book(b, t + H, t + 3 * H), 409, 'BOOKING_OVERLAP');
      code(await book(b, t - H, t + 30 * 60_000), 409, 'BOOKING_OVERLAP');
      expect((await book(b, t + 2 * H, t + 3 * H)).status).toBe(201);
      expect((await book(b, t - H, t)).status).toBe(201);
    });

    it('одночасні запити на той самий час: успішний лише один', async () => {
      const t = Date.now() + 30 * H;
      const res = await Promise.all(
        [a, b, mod, admin].map((u) => book(u, t, t + H)),
      );
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        res.filter((r) => r.body.errorCode === 'BOOKING_OVERLAP'),
      ).toHaveLength(3);
    });

    it('скасоване бронювання звільняє слот', async () => {
      const t = Date.now() + 24 * H;
      const first = await book(a, t, t + H);
      await as(app, a).post(`/api/bookings/${first.body.id}/cancel`).send({});
      expect((await book(b, t, t + H)).status).toBe(201);
      code(
        await as(app, a).post(`/api/bookings/${first.body.id}/cancel`).send({}),
        409,
        'BOOKING_CANCELLED',
      );
    });

    it('обмеження: минуле, понад 12 год, далі 60 днів, кінець до початку', async () => {
      const now = Date.now();
      code(await book(a, now - 2 * H, now - H), 400, 'BOOKING_IN_PAST');
      code(await book(a, now + H, now + 14 * H), 400, 'BOOKING_TOO_LONG');
      code(
        await book(a, now + 61 * 24 * H, now + 61 * 24 * H + H),
        400,
        'BOOKING_TOO_FAR',
      );
      code(await book(a, now + 2 * H, now + H), 400, 'INVALID_PERIOD');
    });

    it('обладнання на обслуговуванні не бронюється', async () => {
      await as(app, admin)
        .patch(`/api/places/${placeId}`)
        .send({ status: 'maintenance' });
      const t = Date.now() + 24 * H;
      code(await book(a, t, t + H), 409, 'PLACE_UNAVAILABLE');
    });

    it('допуск має діяти до кінця бронювання', async () => {
      const p = await as(app, admin).post('/api/places').send({
        code: 'LASER-2',
        title: 'Лазер',
        category: 'Верстати',
        needsAuthorization: true,
      });
      await as(app, mod)
        .post('/api/place-authorizations')
        .send({
          userId: a.id,
          placeId: p.body.id,
          expiresAt: iso(Date.now() + 26 * H),
        })
        .expect(201);
      const t = Date.now() + 24 * H;
      const body = (s: number, e: number) => ({
        placeId: p.body.id,
        startsAt: iso(s),
        endsAt: iso(e),
      });
      expect(
        (
          await as(app, a)
            .post('/api/bookings')
            .send(body(t, t + H))
        ).status,
      ).toBe(201);
      code(
        await as(app, a)
          .post('/api/bookings')
          .send(body(t + 2 * H, t + 4 * H)),
        403,
        'NOT_AUTHORIZED_FOR_PLACE',
      );
    });

    it('календар обладнання і мої бронювання', async () => {
      const t = Date.now() + 24 * H;
      await book(a, t, t + H, { note: 'зйомка' });
      await book(b, t + 2 * H, t + 3 * H);
      const cal = await as(app, b).get(`/api/places/CNC-1/bookings`);
      expect(cal.status).toBe(200);
      expect(cal.body).toHaveLength(2);
      expect(cal.body[0]).toMatchObject({
        note: 'зйомка',
        user: { id: a.id, name: 'Андрій' },
        place: { code: 'CNC-1' },
        cancelled: false,
      });
      const mine = await as(app, a).get('/api/bookings/me');
      expect(mine.body).toHaveLength(1);
      code(
        await as(app, a).get(
          `/api/places/${placeId}/bookings?from=${iso(t)}&to=${iso(t + 70 * 24 * H)}`,
        ),
        400,
        'INVALID_PERIOD',
      );
    });

    it('чужий поточний слот блокує старт сеансу, свій — ні', async () => {
      // Слот, що вже почався (вставляємо напряму, бо API не приймає минуле).
      await ds.query(
        `INSERT INTO bookings (place_id, user_id, starts_at, ends_at)
         VALUES ($1, $2, now() - interval '10 minutes', now() + interval '1 hour')`,
        [placeId, a.id],
      );
      code(await start(b), 409, 'PLACE_BOOKED');
      code(await start(mod), 409, 'PLACE_BOOKED');
      expect((await start(a)).status).toBe(201);
    });

    it('admin може почати сеанс у чужий слот', async () => {
      await ds.query(
        `INSERT INTO bookings (place_id, user_id, starts_at, ends_at)
         VALUES ($1, $2, now() - interval '10 minutes', now() + interval '1 hour')`,
        [placeId, a.id],
      );
      expect((await start(admin)).status).toBe(201);
    });
  });

  describe('автозакриття сеансів', () => {
    it('закриває сеанси старші 12 годин: кінець = початок + 12 год', async () => {
      const s1 = (await start(a)).body.id as string;
      const s2 = (
        await as(app, admin)
          .post(`/api/places/${placeId}/sessions`)
          .send({ safetyConfirmed: true })
      ).body; // exclusive place: admin cannot start while busy
      expect(s2.errorCode).toBe('PLACE_IN_USE');
      await ds.query(
        `UPDATE work_sessions SET started_at = now() - interval '13 hours' WHERE id = $1`,
        [s1],
      );
      const n = await app.get(WorkSessionsService).autoCloseStale();
      expect(n).toBe(1);
      const [row] = await ds.query<
        { auto_closed: boolean; end_reason: string; hours: number }[]
      >(
        `SELECT auto_closed, end_reason,
                extract(epoch FROM ended_at - started_at) / 3600 AS hours
         FROM work_sessions WHERE id = $1`,
        [s1],
      );
      expect(row).toMatchObject({
        auto_closed: true,
        end_reason: 'закрито автоматично',
      });
      expect(Number(row.hours)).toBe(12);
      const [log] = await ds.query<{ actor_id: string | null }[]>(
        `SELECT actor_id FROM audit_log WHERE action = 'session.auto_closed' AND entity_id = $1`,
        [s1],
      );
      expect(log.actor_id).toBeNull();
      // Обладнання знову вільне.
      expect((await start(b)).status).toBe(201);
    });

    it('свіжі сеанси не чіпає', async () => {
      await start(a);
      expect(await app.get(WorkSessionsService).autoCloseStale()).toBe(0);
    });

    it('у списку сеансів видно позначку', async () => {
      const s = (await start(a)).body.id as string;
      await ds.query(
        `UPDATE work_sessions SET started_at = now() - interval '20 hours' WHERE id = $1`,
        [s],
      );
      await app.get(WorkSessionsService).autoCloseStale();
      const list = await as(app, a).get('/api/work-sessions');
      expect(list.body.items[0]).toMatchObject({ id: s, autoClosed: true });
    });
  });

  describe('останні сеанси на обладнанні', () => {
    it('бачать усі: хто, коли, без нотаток; загальний журнал member — лише свій', async () => {
      const s1 = await start(a);
      await as(app, a)
        .patch(`/api/work-sessions/${s1.body.id}/end`)
        .send({ note: 'Приватна нотатка' })
        .expect(200);
      await start(b).expect(201);

      const res = await as(app, a)
        .get('/api/places/CNC-1/sessions/recent')
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].user.name).toBe('Богдана');
      expect(res.body[0].endedAt).toBeNull();
      expect(res.body[1].user.name).toBe('Андрій');
      for (const row of res.body as Record<string, unknown>[]) {
        expect(Object.keys(row).sort()).toEqual(
          ['autoClosed', 'endedAt', 'id', 'startedAt', 'user'].sort(),
        );
      }
      expect(JSON.stringify(res.body)).not.toContain('Приватна нотатка');

      const own = await as(app, a)
        .get(`/api/work-sessions?placeId=${placeId}`)
        .expect(200);
      expect(own.body.items).toHaveLength(1);
    });

    it('не більше 10, найновіші першими; архівне обладнання member не бачить', async () => {
      for (let i = 0; i < 12; i++) {
        const s = await start(a);
        await as(app, a)
          .patch(`/api/work-sessions/${s.body.id}/end`)
          .send({})
          .expect(200);
      }
      const res = await as(app, b)
        .get(`/api/places/${placeId}/sessions/recent`)
        .expect(200);
      expect(res.body).toHaveLength(10);
      const times = (res.body as { startedAt: string }[]).map((r) =>
        Date.parse(r.startedAt),
      );
      expect([...times].sort((x, y) => y - x)).toEqual(times);

      await as(app, admin)
        .patch(`/api/places/${placeId}`)
        .send({ status: 'archived' })
        .expect(200);
      code(
        await as(app, b).get(`/api/places/${placeId}/sessions/recent`),
        404,
        'PLACE_NOT_FOUND',
      );
    });
  });

  describe('вивантаження журналу', () => {
    async function session(u: TestUser, startIso: string, minutes: number) {
      await ds.query(
        `INSERT INTO work_sessions (user_id, place_id, started_at, ended_at, ended_by_id, safety_confirmed)
         VALUES ($1, $2, $3::timestamptz, $3::timestamptz + make_interval(mins => $4), $1, true)`,
        [u.id, placeId, startIso, minutes],
      );
    }

    beforeEach(async () => {
      await session(a, '2026-10-05T07:00:00Z', 90);
      await session(b, '2026-10-20T12:00:00Z', 45);
      await session(a, '2026-11-02T08:00:00Z', 30); // інший місяць
    });

    const period = 'from=2026-09-30T21:00:00Z&to=2026-10-31T22:00:00Z';

    it('CSV за місяць: київський час, тривалість, фільтри', async () => {
      const res = await as(app, mod).get(
        `/api/work-sessions/export.csv?${period}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('equipment-log.csv');
      const lines = res.text.replace('\ufeff', '').trim().split('\r\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toBe(
        'Фрезер,CNC-1,Андрій,2026-10-05 10:00,2026-10-05 11:30,1:30,90,',
      );
      expect(lines[2]).toContain('Богдана,2026-10-20 15:00');

      const onlyB = await as(app, mod).get(
        `/api/work-sessions/export.csv?${period}&userId=${b.id}`,
      );
      expect(onlyB.text.trim().split('\r\n')).toHaveLength(2);
    });

    it('сторінка для друку: таблиця, підсумки, власний CSP без скриптів', async () => {
      const res = await as(app, admin).get(
        `/api/work-sessions/report?${period}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src');
      expect(res.text).toContain('Журнал роботи з обладнанням');
      expect(res.text).toContain('Сеансів: 2 · Загальний час: 2:15');
      expect(res.text).toContain('Підсумок за особами');
      expect(res.text).not.toContain('2026-11-02');
    });

    it('без періоду — поточний місяць (Київ)', async () => {
      await session(b, new Date(Date.now() - 60_000).toISOString(), 1);
      const [{ n }] = await ds.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM work_sessions
         WHERE started_at >= date_trunc('month', now(), 'Europe/Kyiv')`,
      );
      const res = await as(app, mod).get('/api/work-sessions/export.csv');
      expect(res.status).toBe(200);
      const lines = res.text.replace('\ufeff', '').trim().split('\r\n');
      expect(lines).toHaveLength(1 + n);
      expect(res.text).not.toContain('2026-10-05');
    });

    it('кривий період — помилка', async () => {
      code(
        await as(app, mod).get(
          '/api/work-sessions/export.csv?from=2026-11-01T00:00:00Z&to=2026-10-01T00:00:00Z',
        ),
        400,
        'INVALID_PERIOD',
      );
    });

    it('відкривається через cookie-вхід (як посилання з вебу)', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-DC-Client', 'web')
        .send({ email: mod.email, password: 'test-password-123' });
      const cookies = login.headers['set-cookie'] as unknown as string[];
      const res = await request(app.getHttpServer())
        .get(`/api/work-sessions/report?${period}`)
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
    });
  });

  describe('несправності', () => {
    it('звіт → обслуговування → закриття з поверненням у роботу', async () => {
      const f = await as(app, a)
        .post('/api/faults')
        .send({ placeId, description: 'Шпиндель шумить' });
      expect(f.status).toBe(201);
      expect(f.body).toMatchObject({
        status: 'open',
        reporter: { id: a.id, name: 'Андрій' },
        place: { code: 'CNC-1', status: 'active' },
      });
      const id = f.body.id as string;

      const ph = await as(app, a)
        .post(`/api/faults/${id}/photos`)
        .attach('file', PNG_1PX, 'фото.png');
      expect(ph.body.photos).toHaveLength(1);
      const img = await as(app, b).get(
        `/api/faults/${id}/photos/${ph.body.photos[0].id}`,
      );
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toBe('image/png');

      const m = await as(app, mod).post(`/api/faults/${id}/maintenance`);
      expect(m.body).toMatchObject({
        status: 'in_progress',
        place: { status: 'maintenance' },
      });
      code(await start(b), 409, 'PLACE_UNAVAILABLE');

      code(
        await as(app, mod).post(`/api/faults/${id}/close`).send({}),
        400,
        'VALIDATION_ERROR',
      );
      const c = await as(app, mod)
        .post(`/api/faults/${id}/close`)
        .send({ resolution: 'Замінили підшипник', reactivatePlace: true });
      expect(c.body).toMatchObject({
        status: 'closed',
        resolution: 'Замінили підшипник',
        closedBy: { id: mod.id },
        place: { status: 'active' },
      });
      expect((await start(b)).status).toBe(201);
      code(
        await as(app, mod)
          .post(`/api/faults/${id}/close`)
          .send({ resolution: 'x' }),
        409,
        'FAULT_CLOSED',
      );
      code(
        await as(app, a)
          .post(`/api/faults/${id}/photos`)
          .attach('file', PNG_1PX, 'f.png'),
        409,
        'FAULT_CLOSED',
      );

      const actions = (
        await ds.query<{ action: string }[]>(
          `SELECT action FROM audit_log WHERE entity_id IN ($1, $2) ORDER BY created_at`,
          [id, placeId],
        )
      ).map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'fault.created',
          'fault.photo_added',
          'fault.maintenance',
          'place.updated',
          'fault.closed',
        ]),
      );
    });

    it('«в роботу» без зупинки обладнання; закриття без повернення', async () => {
      const id = (
        await as(app, a)
          .post('/api/faults')
          .send({ placeId, description: 'Подряпина' })
      ).body.id as string;
      const r = await as(app, mod).post(`/api/faults/${id}/in-progress`);
      expect(r.body).toMatchObject({
        status: 'in_progress',
        place: { status: 'active' },
      });
      await as(app, mod).post(`/api/faults/${id}/maintenance`);
      const c = await as(app, mod)
        .post(`/api/faults/${id}/close`)
        .send({ resolution: 'Чекаємо запчастину' });
      expect(c.body.place.status).toBe('maintenance');
    });

    it('максимум 3 фото, лише картинки', async () => {
      const id = (
        await as(app, a).post('/api/faults').send({ placeId, description: 'x' })
      ).body.id as string;
      const up = (buf: Buffer, name: string) =>
        as(app, a).post(`/api/faults/${id}/photos`).attach('file', buf, name);
      code(
        await up(Buffer.from('%PDF-1.4'), 'a.pdf'),
        400,
        'FILE_TYPE_NOT_ALLOWED',
      );
      for (let i = 0; i < 3; i++) {
        expect((await up(PNG_1PX, `${i}.png`)).status).toBe(201);
      }
      code(await up(PNG_1PX, '4.png'), 409, 'FAULT_PHOTO_LIMIT');
    });

    it('список з фільтрами', async () => {
      await as(app, a).post('/api/faults').send({ placeId, description: '1' });
      const second = await as(app, b)
        .post('/api/faults')
        .send({ placeId, description: '2' });
      await as(app, mod)
        .post(`/api/faults/${second.body.id}/close`)
        .send({ resolution: 'ok' });
      const open = await as(app, b).get(
        `/api/faults?placeId=${placeId}&status=open`,
      );
      expect(open.body).toMatchObject({ total: 1 });
      expect(open.body.items[0]).toMatchObject({
        description: '1',
        photosCount: 0,
      });
    });
  });

  describe('проєкти: етапи й дати', () => {
    it('створення з етапом і датами, фільтр за етапом', async () => {
      const p = await as(app, mod).post('/api/projects').send({
        title: 'Фестиваль',
        stage: 'idea',
        startDate: '2026-11-10',
        deadline: '2026-12-20',
      });
      expect(p.status).toBe(201);
      expect(p.body).toMatchObject({
        stage: 'idea',
        startDate: '2026-11-10',
        deadline: '2026-12-20',
      });
      const def = await as(app, mod)
        .post('/api/projects')
        .send({ title: 'Інше' });
      expect(def.body).toMatchObject({
        stage: 'planning',
        startDate: null,
        deadline: null,
      });
      const list = await as(app, a).get('/api/projects?stage=idea');
      expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([
        p.body.id,
      ]);
    });

    it('лише фіксовані етапи, дедлайн не раніше початку', async () => {
      code(
        await as(app, mod)
          .post('/api/projects')
          .send({ title: 'x', stage: 'Планується' }),
        400,
        'VALIDATION_ERROR',
      );
      code(
        await as(app, mod).post('/api/projects').send({
          title: 'x',
          startDate: '2026-12-01',
          deadline: '2026-11-01',
        }),
        400,
        'PROJECT_DATES_INVALID',
      );
      code(
        await as(app, mod)
          .post('/api/projects')
          .send({ title: 'x', deadline: '01.12.2026' }),
        400,
        'VALIDATION_ERROR',
      );
      const p = await as(app, mod)
        .post('/api/projects')
        .send({ title: 'x', startDate: '2026-12-01' });
      code(
        await as(app, mod)
          .patch(`/api/projects/${p.body.id}`)
          .send({ deadline: '2026-11-30' }),
        400,
        'PROJECT_DATES_INVALID',
      );
      const cleared = await as(app, mod)
        .patch(`/api/projects/${p.body.id}`)
        .send({ startDate: null, deadline: '2026-11-30' });
      expect(cleared.body).toMatchObject({
        startDate: null,
        deadline: '2026-11-30',
      });
    });

    it('учасник змінює етап, зміна в історії', async () => {
      const p = await as(app, mod)
        .post('/api/projects')
        .send({ title: 'x', memberIds: [a.id] });
      const upd = await as(app, a)
        .patch(`/api/projects/${p.body.id}`)
        .send({ stage: 'execution' });
      expect(upd.body.stage).toBe('execution');
      const hist = await as(app, a).get(`/api/projects/${p.body.id}/history`);
      expect(hist.body[0]).toMatchObject({
        action: 'project.updated',
        meta: { stage: { from: 'planning', to: 'execution' } },
      });
    });
  });
});
