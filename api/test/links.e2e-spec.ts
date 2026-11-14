import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeUser,
  resetDb,
  TestUser,
} from './helpers';

// Зв'язки між записами (0.4а): record_links, /api/links, фільтр Архіву й склад через зв'язки.

type Link = {
  id: string;
  direction: 'out' | 'in';
  type: string;
  recordId: string;
  title: string;
  archived: boolean;
  role: string;
  canRemove: boolean;
};

describe("Зв'язки між записами (e2e)", () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let taskId: string;
  let projectId: string;
  let placeId: string;
  let itemId: string;
  let docId: string;
  let hiddenDocId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const doc = async (title: string, accessScope = 'members') =>
    (
      await as(app, mod)
        .post('/api/documents')
        .field('title', title)
        .field('category', 'pasporty')
        .field('accessScope', accessScope)
        .attach('file', Buffer.from('текст'), 'a.txt')
        .expect(201)
    ).body.id as string;

  beforeEach(async () => {
    await resetDb(app);
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    await category(app, 'place_category', 'Верстати');
    await category(app, 'document_category', 'Паспорти');
    await category(app, 'inventory_category', 'Матеріали');
    taskId = (
      await as(app, mod)
        .post('/api/tasks')
        .send({ title: 'Корпус', points: 5 })
        .expect(201)
    ).body.id;
    projectId = (
      await as(app, mod)
        .post('/api/projects')
        .send({ title: 'Робот', memberIds: [member.id] })
        .expect(201)
    ).body.id;
    placeId = (
      await as(app, mod)
        .post('/api/places')
        .send({ code: 'CNC-1', title: 'Фрезер', category: 'verstaty' })
        .expect(201)
    ).body.id;
    itemId = (
      await as(app, mod)
        .post('/api/inventory/items')
        .send({ code: 'PLY-1', title: 'Фанера', category: 'materialy' })
        .expect(201)
    ).body.id;
    docId = await doc('Паспорт фрезера');
    hiddenDocId = await doc('Акт для модераторів', 'supervisors');
  });

  const link = (
    who: TestUser,
    fromType: string,
    fromId: string,
    toType: string,
    toId: string,
    role?: string,
  ) =>
    as(app, who)
      .post('/api/links')
      .send({ fromType, fromId, toType, toId, ...(role ? { role } : {}) });

  const links = async (who: TestUser, type: string, id: string) =>
    (await as(app, who).get(`/api/links?type=${type}&id=${id}`).expect(200))
      .body as Link[];

  const audit = (action: string) =>
    app.get(DataSource).getRepository(AuditLog).findBy({ action });

  it('ТЗ ↔ проєкт: видно з обох боків, з напрямком і назвою; аудит', async () => {
    const res = await link(mod, 'task', taskId, 'project', projectId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      direction: 'out',
      type: 'project',
      recordId: projectId,
      title: 'Робот',
      role: '',
      canRemove: true,
    });

    expect(await links(member, 'task', taskId)).toMatchObject([
      { direction: 'out', type: 'project', title: 'Робот', canRemove: false },
    ]);
    expect(await links(member, 'project', projectId)).toMatchObject([
      { direction: 'in', type: 'task', recordId: taskId, title: 'Корпус' },
    ]);

    const [created] = await audit('link.created');
    expect(created).toMatchObject({
      actorId: mod.id,
      entity: 'task',
      entityId: taskId,
      meta: { toType: 'project', toId: projectId, role: '' },
    });
  });

  it('та сама пара двічі — LINK_DUPLICATE, у будь-якому напрямку; інша роль — можна', async () => {
    await link(mod, 'document', docId, 'place', placeId).expect(201);
    const again = await link(mod, 'document', docId, 'place', placeId);
    expect(again.status).toBe(409);
    expect(again.body.errorCode).toBe('LINK_DUPLICATE');
    const back = await link(mod, 'place', placeId, 'document', docId);
    expect(back.status).toBe(409);
    expect(back.body.errorCode).toBe('LINK_DUPLICATE');
    await link(mod, 'place', placeId, 'document', docId, 'passport').expect(
      201,
    );
  });

  it('помилки: сам із собою, тип не зв’язується, запису немає, погана роль', async () => {
    const self = await link(mod, 'task', taskId, 'task', taskId);
    expect(self.status).toBe(400);
    expect(self.body.errorCode).toBe('LINK_SELF');

    const type = await link(mod, 'task', taskId, 'user', member.id);
    expect(type.status).toBe(400);
    expect(type.body.errorCode).toBe('LINK_TYPE_INVALID');

    const missing = await link(
      mod,
      'task',
      taskId,
      'place',
      '00000000-0000-4000-8000-000000000000',
    );
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe('RECORD_NOT_FOUND');

    const role = await link(mod, 'task', taskId, 'place', placeId, 'Bad Role');
    expect(role.status).toBe(400);

    const list = await as(app, mod).get(`/api/links?type=user&id=${member.id}`);
    expect(list.status).toBe(400);
    expect(list.body.errorCode).toBe('LINK_TYPE_INVALID');
  });

  it('учасник не бачить прихованого документа ні у зв’язках, ні як запис', async () => {
    await link(mod, 'document', docId, 'place', placeId).expect(201);
    await link(mod, 'document', hiddenDocId, 'place', placeId).expect(201);

    expect((await links(mod, 'place', placeId)).map((l) => l.title)).toEqual([
      'Паспорт фрезера',
      'Акт для модераторів',
    ]);
    expect((await links(member, 'place', placeId)).map((l) => l.title)).toEqual(
      ['Паспорт фрезера'],
    );
    await as(app, member)
      .get(`/api/links?type=document&id=${hiddenDocId}`)
      .expect(404);
  });

  it('member зв’язує від проєкту, де учасник, але не до прихованого документа', async () => {
    await link(member, 'project', projectId, 'task', taskId).expect(201);
    const hidden = await link(
      member,
      'project',
      projectId,
      'document',
      hiddenDocId,
    );
    expect(hidden.status).toBe(404);
    expect(hidden.body.errorCode).toBe('RECORD_NOT_FOUND');
  });

  it('прибрати: лише той, хто редагує джерело; аудит', async () => {
    const l = await link(mod, 'task', taskId, 'project', projectId).expect(201);
    // Member — учасник проєкту, але джерело — ТЗ.
    const denied = await as(app, member).delete(`/api/links/${l.body.id}`);
    expect(denied.status).toBe(403);
    expect(denied.body.errorCode).toBe('FORBIDDEN');

    await as(app, admin).delete(`/api/links/${l.body.id}`).expect(200);
    expect(await links(mod, 'task', taskId)).toEqual([]);
    const [removed] = await audit('link.removed');
    expect(removed).toMatchObject({
      actorId: admin.id,
      entity: 'task',
      entityId: taskId,
    });
    const gone = await as(app, admin).delete(`/api/links/${l.body.id}`);
    expect(gone.status).toBe(404);
    expect(gone.body.errorCode).toBe('LINK_NOT_FOUND');
  });

  it('видалене ТЗ забирає свої зв’язки', async () => {
    await link(mod, 'task', taskId, 'project', projectId).expect(201);
    await link(mod, 'document', docId, 'task', taskId).expect(201);
    await as(app, mod).delete(`/api/tasks/${taskId}`).expect(200);
    expect(await links(mod, 'project', projectId)).toEqual([]);
    expect(await links(mod, 'document', docId)).toEqual([]);
  });

  it('архівне обладнання видно у зв’язках лише персоналу, з позначкою', async () => {
    await link(mod, 'document', docId, 'place', placeId).expect(201);
    await as(app, mod)
      .patch(`/api/places/${placeId}`)
      .send({ status: 'archived' })
      .expect(200);
    expect(await links(mod, 'document', docId)).toMatchObject([
      { type: 'place', archived: true },
    ]);
    expect(await links(member, 'document', docId)).toEqual([]);
  });

  it('Архів фільтрує за пов’язаним записом у будь-якому напрямку', async () => {
    const other = await doc('Інструкція');
    await link(mod, 'document', docId, 'place', placeId).expect(201);
    await link(mod, 'task', taskId, 'document', other).expect(201);

    const byPlace = await as(app, member)
      .get(`/api/documents?linkedType=place&linkedId=${placeId}`)
      .expect(200);
    expect(byPlace.body.items.map((d: { id: string }) => d.id)).toEqual([
      docId,
    ]);
    const byTask = await as(app, member)
      .get(`/api/documents?linkedType=task&linkedId=${taskId}`)
      .expect(200);
    expect(byTask.body.items.map((d: { id: string }) => d.id)).toEqual([other]);
    // Одне без другого — помилка перевірки.
    await as(app, member).get(`/api/documents?linkedType=place`).expect(400);
  });

  it('склад: документи позиції й лічильник — через зв’язки, з урахуванням доступу', async () => {
    await link(mod, 'document', docId, 'inventory_item', itemId).expect(201);
    await link(mod, 'inventory_item', itemId, 'document', hiddenDocId).expect(
      201,
    );
    const asMember = await as(app, member)
      .get(`/api/inventory/items/${itemId}`)
      .expect(200);
    expect(asMember.body.documents.map((d: { id: string }) => d.id)).toEqual([
      docId,
    ]);
    const asMod = await as(app, mod)
      .get(`/api/inventory/items/${itemId}`)
      .expect(200);
    expect(asMod.body.documents).toHaveLength(2);

    const list = await as(app, member).get('/api/inventory/items').expect(200);
    expect(list.body.items[0].documentsCount).toBe(1);
  });
});
