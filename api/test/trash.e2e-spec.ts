import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { StorageService } from '../src/files/storage.service';
import { TrashService } from '../src/trash/trash.service';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeUser,
  resetDb,
  TestUser,
} from './helpers';

// Кошик (6.6а): «Видалити» обладнання, позиції складу, файлу архіву, проєкту —
// у кошик (зникає скрізь), «Відновити» (staff), «Видалити назавжди» (admin;
// сервер — через 90 днів). З історією лишається назва; без — стирається все,
// і файли з диска. Архів («В архів») — окремо, кошик його не чіпає.

const PDF = Buffer.from('%PDF-1.4\n%скан\n', 'utf8');
const DAY = 86_400_000;

type TrashItem = {
  type: string;
  id: string;
  title: string;
  code: string | null;
  deletedAt: string;
  deletedBy: { id: string; name: string } | null;
  purgeAt: string;
};

describe('Кошик (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;

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
    await category(app, 'place_category', 'Верстати');
    await category(app, 'inventory_category', 'Матеріали');
    await category(app, 'document_category', 'Паспорти');
  });

  const code = (
    res: { status: number; body: { errorCode?: string } },
    status: number,
    errorCode: string,
  ) => {
    expect([res.status, res.body.errorCode]).toEqual([status, errorCode]);
  };
  const place = async (c = 'CNC-1', title = 'Фрезер') =>
    (
      await as(app, mod)
        .post('/api/places')
        .send({ code: c, title, category: 'verstaty' })
        .expect(201)
    ).body.id as string;
  const item = async (c = 'PLY-4', quantity = 0) =>
    (
      await as(app, mod)
        .post('/api/inventory/items')
        .send({ code: c, title: 'Фанера', category: 'materialy', quantity })
        .expect(201)
    ).body.id as string;
  const file = async (title = 'Паспорт') =>
    (
      await as(app, mod)
        .post('/api/documents')
        .field('title', title)
        .field('category', 'pasporty')
        .attach('file', Buffer.from('текст'), 'a.txt')
        .expect(201)
    ).body.id as string;
  const project = async (title = 'Робот') =>
    (
      await as(app, mod)
        .post('/api/projects')
        .send({ title, memberIds: [member.id] })
        .expect(201)
    ).body.id as string;
  const trash = async (u: TestUser = mod, query = '') =>
    (await as(app, u).get(`/api/trash${query}`).expect(200)).body as {
      items: TrashItem[];
      total: number;
    };
  const purge = (type: string, id: string, u: TestUser = admin) =>
    as(app, u).delete(`/api/trash/${type}/${id}`);
  const restore = (type: string, id: string, u: TestUser = mod) =>
    as(app, u).post(`/api/trash/${type}/${id}/restore`);
  const audit = (action: string) =>
    ds
      .getRepository(AuditLog)
      .find({ where: { action }, order: { createdAt: 'ASC' } });
  const storage = () => app.get(StorageService);
  const stored = async (
    table: string,
    column: string,
    where: string,
    id: string,
  ) =>
    (
      await ds.query<{ s: string }[]>(
        `SELECT ${column} AS s FROM ${table} WHERE ${where} = $1`,
        [id],
      )
    ).map((r) => r.s);

  describe('обладнання', () => {
    it('у кошику зникає зі списку, за кодом — PLACE_DELETED, з пошуку; відновлення повертає', async () => {
      const id = await place();
      await as(app, mod).delete(`/api/places/${id}`).expect(200);

      const list = await as(app, mod).get('/api/places').expect(200);
      expect(list.body).toEqual([]);
      code(
        await as(app, member).get(`/api/places/${id}`),
        404,
        'PLACE_DELETED',
      );
      code(
        await as(app, member).get('/api/places/cnc-1'),
        404,
        'PLACE_DELETED',
      );
      const found = await as(app, mod)
        .get('/api/links/candidates?type=place&q=Фрезер')
        .expect(200);
      expect(found.body).toEqual([]);
      code(
        await as(app, admin)
          .post(`/api/places/${id}/sessions`)
          .send({ safetyConfirmed: true }),
        404,
        'PLACE_DELETED',
      );

      expect((await trash()).items).toEqual([
        {
          type: 'place',
          id,
          title: 'Фрезер',
          code: 'CNC-1',
          deletedAt: expect.any(String),
          deletedBy: { id: mod.id, name: mod.name },
          purgeAt: expect.any(String),
        },
      ]);
      const [it] = (await trash()).items;
      expect(Date.parse(it.purgeAt) - Date.parse(it.deletedAt)).toBe(90 * DAY);
      // Код зайнятий, поки в кошику: відновлення не впреться в конфлікт.
      code(
        await as(app, mod)
          .post('/api/places')
          .send({ code: 'CNC-1', title: 'Інший', category: 'verstaty' }),
        409,
        'PLACE_CODE_TAKEN',
      );

      await restore('place', id).expect(200);
      await as(app, member).get(`/api/places/${id}`).expect(200);
      expect((await trash()).items).toEqual([]);
      expect((await audit('trash.deleted')).map((a) => a.entity)).toEqual([
        'place',
      ]);
      expect(await audit('trash.restored')).toMatchObject([
        {
          actorId: mod.id,
          entity: 'place',
          entityId: id,
          meta: { title: 'Фрезер' },
        },
      ]);
    });

    it('у роботі — PLACE_IN_USE; майбутні бронювання скасовуються з причиною', async () => {
      const id = await place();
      const start = new Date(Date.now() + DAY);
      const booking = await as(app, admin)
        .post('/api/bookings')
        .send({
          placeId: id,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
        })
        .expect(201);
      const s = await as(app, admin)
        .post(`/api/places/${id}/sessions`)
        .send({ safetyConfirmed: true })
        .expect(201);
      code(await as(app, mod).delete(`/api/places/${id}`), 409, 'PLACE_IN_USE');

      await as(app, admin)
        .patch(`/api/work-sessions/${s.body.id}/end`)
        .send({})
        .expect(200);
      await as(app, mod).delete(`/api/places/${id}`).expect(200);
      const [b] = await ds.query<
        { cancelled_by_id: string; cancel_reason: string }[]
      >(`SELECT cancelled_by_id, cancel_reason FROM bookings WHERE id = $1`, [
        booking.body.id,
      ]);
      expect(b).toEqual({
        cancelled_by_id: mod.id,
        cancel_reason: 'Обладнання видалено',
      });
    });

    it('назавжди: з сеансами лишається назва з кодом, код звільняється; без історії — рядок стерто', async () => {
      const used = await place();
      const s = await as(app, admin)
        .post(`/api/places/${used}/sessions`)
        .send({ safetyConfirmed: true })
        .expect(201);
      await as(app, admin)
        .patch(`/api/work-sessions/${s.body.id}/end`)
        .send({})
        .expect(200);
      await as(app, mod)
        .patch(`/api/places/${used}`)
        .send({ location: 'Кім. 3' })
        .expect(200);
      const fresh = await place('LASER', 'Лазер');
      await as(app, mod).delete(`/api/places/${used}`).expect(200);
      await as(app, mod).delete(`/api/places/${fresh}`).expect(200);

      await purge('place', used).expect(200);
      await purge('place', fresh).expect(200);
      expect(
        await ds.query(
          `SELECT title, code, location, purged_at IS NOT NULL AS purged FROM places`,
        ),
      ).toEqual([
        { title: 'Фрезер', code: 'CNC-1', location: '', purged: true },
      ]);
      expect((await trash()).items).toEqual([]);
      expect(await audit('trash.purged')).toMatchObject([
        {
          actorId: admin.id,
          entityId: used,
          meta: { title: 'Фрезер', kept: true },
        },
        {
          actorId: admin.id,
          entityId: fresh,
          meta: { title: 'Лазер', kept: false },
        },
      ]);
      // Сеанси лишилися в історії.
      expect(
        await stored('work_sessions', 'place_id', 'id', s.body.id),
      ).toEqual([used]);

      // Код вільний: стара наклейка відкриє нове обладнання.
      const again = await place('CNC-1', 'Новий фрезер');
      expect(
        (await as(app, member).get('/api/places/CNC-1').expect(200)).body.id,
      ).toBe(again);
      // Видалене назавжди не відновлюється і вдруге не стирається.
      await restore('place', used).expect(404);
      await purge('place', used).expect(404);
    });
  });

  describe('склад', () => {
    it('залишок списується рухом; запис лишається з назвою (рух — історія)', async () => {
      const id = await item('PLY-4', 7);
      await as(app, mod).delete(`/api/inventory/items/${id}`).expect(200);
      expect(await ds.query(`SELECT quantity FROM inventory_items`)).toEqual([
        { quantity: '0.000' },
      ]);
      const moves = await as(app, mod)
        .get(`/api/inventory/movements?itemId=${id}`)
        .expect(200);
      expect(moves.body.items).toMatchObject([
        {
          delta: -7,
          quantityAfter: 0,
          note: 'Списано: позицію видалено',
          actor: { id: mod.id },
        },
        { delta: 7, note: 'Початковий залишок' },
      ]);
      const list = await as(app, member)
        .get('/api/inventory/items')
        .expect(200);
      expect(list.body.total).toBe(0);
      code(
        await as(app, member).get('/api/inventory/items/PLY-4'),
        404,
        'ITEM_DELETED',
      );
      code(
        await as(app, member)
          .post(`/api/inventory/items/${id}/movements`)
          .send({ delta: -1, note: 'Взяв' }),
        404,
        'ITEM_NOT_FOUND',
      );

      await purge('inventory_item', id).expect(200);
      expect(
        await ds.query(
          `SELECT title, purged_at IS NOT NULL AS purged FROM inventory_items`,
        ),
      ).toEqual([{ title: 'Фанера', purged: true }]);
      // Код вільний.
      await item('PLY-4');
    });

    it('без руху й залишку — стирається повністю', async () => {
      const id = await item('PLY-5', 0);
      await as(app, mod).delete(`/api/inventory/items/${id}`).expect(200);
      await purge('inventory_item', id).expect(200);
      expect(await ds.query(`SELECT id FROM inventory_items`)).toEqual([]);
    });
  });

  describe('файли архіву', () => {
    it('«В архів» і назад — не кошик; «Видалити» — кошик; назавжди — файли з диска', async () => {
      const id = await file();
      await as(app, mod).post(`/api/documents/${id}/archive`).expect(200);
      expect((await trash()).items).toEqual([]);
      const back = await as(app, mod)
        .post(`/api/documents/${id}/unarchive`)
        .expect(200);
      expect(back.body.archived).toBe(false);
      expect((await audit('document.unarchived')).length).toBe(1);

      await as(app, mod)
        .post(`/api/documents/${id}/files`)
        .attach('file', Buffer.from('друга'), 'b.txt')
        .expect(201);
      const names = await stored(
        'document_versions',
        'stored_name',
        'doc_id',
        id,
      );
      expect(names.length).toBe(2);

      await as(app, mod).delete(`/api/documents/${id}`).expect(200);
      await as(app, mod).get(`/api/documents/${id}`).expect(404);
      const archive = await as(app, mod).get('/api/archive').expect(200);
      expect(archive.body.items).toEqual([]);
      for (const n of names)
        expect(await storage().exists(`documents/${n}`)).toBe(true);

      await purge('document', id).expect(200);
      expect(await ds.query(`SELECT id FROM documents`)).toEqual([]);
      for (const n of names)
        expect(await storage().exists(`documents/${n}`)).toBe(false);
    });

    it('підписаний скан документа редактора не видаляється — DOCUMENT_SIGNED_SCAN', async () => {
      const p = (
        await as(app, member)
          .post('/api/papers')
          .send({ title: 'Протокол' })
          .expect(201)
      ).body as { id: string };
      await as(app, member).post(`/api/papers/${p.id}/publish`).expect(200);
      await as(app, member).post(`/api/papers/${p.id}/freeze`).expect(200);
      await as(app, member)
        .post(`/api/papers/${p.id}/signed`)
        .attach('file', PDF, 'скан.pdf')
        .expect(200);
      const [{ id }] = await ds.query<{ id: string }[]>(
        `SELECT archive_doc_id AS id FROM paper_snapshots WHERE paper_id = $1`,
        [p.id],
      );
      code(
        await as(app, mod).delete(`/api/documents/${id}`),
        409,
        'DOCUMENT_SIGNED_SCAN',
      );
    });
  });

  describe('проєкти', () => {
    it('«В архів» — не кошик; «Видалити» — кошик; згадка в опублікованому документі — назва лишається, файли стерто', async () => {
      const archived = await project('Старий');
      await as(app, mod).post(`/api/projects/${archived}/archive`).expect(200);
      expect((await trash()).items).toEqual([]);

      const id = await project();
      await as(app, member)
        .post(`/api/projects/${id}/files`)
        .attach('file', Buffer.from('креслення'), 'a.txt')
        .expect(201);
      const [name] = await stored(
        'project_files',
        'stored_name',
        'project_id',
        id,
      );
      const p = (
        await as(app, member)
          .post('/api/papers')
          .send({
            title: 'Звіт',
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'mention', attrs: { type: 'project', id } },
                  ],
                },
              ],
            },
          })
          .expect(201)
      ).body as { id: string };
      await as(app, member).post(`/api/papers/${p.id}/publish`).expect(200);

      await as(app, mod).delete(`/api/projects/${id}`).expect(200);
      const list = await as(app, member).get('/api/projects').expect(200);
      expect(list.body.items).toEqual([]);
      await as(app, member).get(`/api/projects/${id}`).expect(404);
      // Документ відкривається, видаленого проєкту в ньому не видно.
      const paper = await as(app, member)
        .get(`/api/papers/${p.id}`)
        .expect(200);
      expect(paper.body.refs).toEqual([]);

      await purge('project', id).expect(200);
      expect(
        await ds.query(
          `SELECT title, description, purged_at IS NOT NULL AS purged FROM projects WHERE id = $1`,
          [id],
        ),
      ).toEqual([{ title: 'Робот', description: '', purged: true }]);
      expect(
        await ds.query(`SELECT * FROM project_members WHERE project_id = $1`, [
          id,
        ]),
      ).toEqual([]);
      expect(await storage().exists(`projects/${name}`)).toBe(false);
      // Зв'язок документа з проєктом лишився: це історія.
      expect(
        await ds.query(
          `SELECT 1 FROM record_links WHERE from_id = $1 AND to_id = $2`,
          [p.id, id],
        ),
      ).toHaveLength(1);
    });

    it("чернетка не тримає: без історії стирається з її зв'язками", async () => {
      const id = await project();
      await as(app, member)
        .post('/api/papers')
        .send({
          title: 'Чернетка',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'mention', attrs: { type: 'project', id } }],
              },
            ],
          },
        })
        .expect(201);
      await as(app, mod).delete(`/api/projects/${id}`).expect(200);
      await purge('project', id).expect(200);
      expect(await ds.query(`SELECT id FROM projects`)).toEqual([]);
      expect(
        await ds.query(`SELECT id FROM record_links WHERE to_id = $1`, [id]),
      ).toEqual([]);
    });
  });

  describe('права й помилки', () => {
    it('учасник не видаляє й не бачить кошика; модератор не видаляє назавжди', async () => {
      const id = await place();
      code(await as(app, member).delete(`/api/places/${id}`), 403, 'FORBIDDEN');
      await as(app, mod).delete(`/api/places/${id}`).expect(200);
      code(await as(app, member).get('/api/trash'), 403, 'FORBIDDEN');
      code(await restore('place', id, member), 403, 'FORBIDDEN');
      code(await purge('place', id, mod), 403, 'FORBIDDEN');
      await restore('place', id, admin).expect(200);
    });

    it('повторне видалення — TRASH_ALREADY_DELETED; не з кошика — TRASH_NOT_DELETED; невідомий тип — 400', async () => {
      const id = await item();
      await as(app, mod).delete(`/api/inventory/items/${id}`).expect(200);
      code(
        await as(app, mod).delete(`/api/inventory/items/${id}`),
        409,
        'TRASH_ALREADY_DELETED',
      );
      await restore('inventory_item', id).expect(200);
      code(await restore('inventory_item', id), 409, 'TRASH_NOT_DELETED');
      code(await purge('inventory_item', id), 409, 'TRASH_NOT_DELETED');
      await as(app, mod).post(`/api/trash/task/${id}/restore`).expect(400);
    });

    it('список: усі типи, нові першими, пошук за назвою й кодом, фільтр за типом', async () => {
      const p = await place();
      const i = await item();
      const d = await file('Інструкція');
      const pr = await project();
      await as(app, mod).delete(`/api/places/${p}`).expect(200);
      await as(app, mod).delete(`/api/inventory/items/${i}`).expect(200);
      await as(app, admin).delete(`/api/documents/${d}`).expect(200);
      await as(app, mod).delete(`/api/projects/${pr}`).expect(200);

      const all = await trash(admin);
      expect(all.total).toBe(4);
      expect(all.items.map((x) => x.type)).toEqual([
        'project',
        'document',
        'inventory_item',
        'place',
      ]);
      expect(all.items[1].deletedBy).toEqual({
        id: admin.id,
        name: admin.name,
      });
      expect((await trash(mod, '?search=ply')).items.map((x) => x.id)).toEqual([
        i,
      ]);
      expect(
        (await trash(mod, '?type=document')).items.map((x) => x.id),
      ).toEqual([d]);
      const page = await trash(mod, '?limit=1&page=2');
      expect([page.total, page.items.map((x) => x.id)]).toEqual([4, [d]]);
    });
  });

  it('сервер видаляє назавжди через 90 днів; аудит без людини', async () => {
    const old = await place();
    const recent = await place('LASER', 'Лазер');
    await as(app, mod).delete(`/api/places/${old}`).expect(200);
    await as(app, mod).delete(`/api/places/${recent}`).expect(200);
    await ds.query(
      `UPDATE places SET deleted_at = now() - interval '90 days 1 minute' WHERE id = $1`,
      [old],
    );

    expect(await app.get(TrashService).autoPurge()).toBe(1);
    expect((await trash()).items.map((x) => x.id)).toEqual([recent]);
    expect(await audit('trash.purged')).toMatchObject([
      {
        actorId: null,
        entityId: old,
        meta: { title: 'Фрезер', kept: false, auto: true, days: 90 },
      },
    ]);
  });
});
