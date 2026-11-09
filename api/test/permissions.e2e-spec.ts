import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import {
  as,
  createTestApp,
  makeUser,
  PNG_1PX,
  resetDb,
  TestUser,
} from './helpers';

// Матриця прав з docs/PLAN.md («Ролі та права») на реальних ендпоінтах.
// Кожен рядок таблиці — describe; у ньому перевірка для кожної ролі.
// Рядок «Розширена панель» — у admin-panel.e2e-spec.ts.

type Res = { status: number; body: { errorCode?: string } };

function denied(res: Res, code = 'FORBIDDEN') {
  expect(res.status).toBe(403);
  expect(res.body.errorCode).toBe(code);
}

function allowed(res: Res) {
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
}

describe('Матриця прав (e2e)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let admin2: TestUser;
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
    admin2 = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    mod2 = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    member2 = await makeUser(app, Role.Member);
  });

  const audit = (action: string, entityId: string) =>
    app.get(DataSource).getRepository(AuditLog).findOneBy({ action, entityId });

  // Рядок «Розширена панель» перевіряється в admin-panel.e2e-spec.ts:
  // там окремий панельний порт і фейковий агент на сервері.

  describe('Журнал усіх дій (аудит)', () => {
    it('admin так', async () => {
      allowed(await as(app, admin).get('/api/audit'));
    });
    it('moderator ні', async () => {
      denied(await as(app, mod).get('/api/audit'));
    });
    it('member ні', async () => {
      denied(await as(app, member).get('/api/audit'));
    });
  });

  describe('Видати або передати адмінку', () => {
    it('admin так', async () => {
      const res = await as(app, admin)
        .patch(`/api/users/${member2.id}`)
        .send({ role: 'admin' });
      allowed(res);
      expect(res.body.role).toBe('admin');
    });
    it('moderator ні', async () => {
      denied(
        await as(app, mod)
          .patch(`/api/users/${member2.id}`)
          .send({ role: 'admin' }),
      );
    });
    it('member ні', async () => {
      denied(
        await as(app, member)
          .patch(`/api/users/${member2.id}`)
          .send({ role: 'admin' }),
      );
    });
    it('останнього адміна не можна позбавити ролі', async () => {
      await as(app, admin)
        .patch(`/api/users/${admin2.id}`)
        .send({ role: 'member' })
        .expect(200);
      const res = await as(app, admin)
        .patch(`/api/users/${admin.id}`)
        .send({ role: 'member' });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('LAST_ADMIN');
    });
  });

  describe('Скинути пароль іншому', () => {
    const body = { newPassword: 'new-password-123' };
    it('admin так, з записом в аудит', async () => {
      allowed(
        await as(app, admin)
          .post(`/api/users/${member2.id}/reset-password`)
          .send(body),
      );
      expect(await audit('user.password_reset', member2.id)).toMatchObject({
        actorId: admin.id,
      });
    });
    it('moderator ні', async () => {
      denied(
        await as(app, mod)
          .post(`/api/users/${member2.id}/reset-password`)
          .send(body),
      );
    });
    it('member ні', async () => {
      denied(
        await as(app, member)
          .post(`/api/users/${member2.id}/reset-password`)
          .send(body),
      );
    });
  });

  describe("Змінити ім'я іншого", () => {
    it('admin так', async () => {
      allowed(
        await as(app, admin)
          .patch(`/api/users/${member2.id}`)
          .send({ name: 'Нове ім’я' }),
      );
    });
    it('moderator ні', async () => {
      denied(
        await as(app, mod)
          .patch(`/api/users/${member2.id}`)
          .send({ name: 'Нове ім’я' }),
      );
    });
    it('member ні', async () => {
      denied(
        await as(app, member)
          .patch(`/api/users/${member2.id}`)
          .send({ name: 'Нове ім’я' }),
      );
    });
  });

  describe('Видалити недоречний аватар чи біо іншого', () => {
    it('admin так: аватар і біо', async () => {
      allowed(await as(app, admin).delete(`/api/users/${member2.id}/avatar`));
      allowed(
        await as(app, admin)
          .patch(`/api/users/${member2.id}`)
          .send({ bio: '' }),
      );
      expect(await audit('user.avatar_removed', member2.id)).toMatchObject({
        actorId: admin.id,
      });
    });
    it('moderator ні', async () => {
      denied(
        await as(app, mod).delete(`/api/users/${member2.id}/avatar`),
        'NOT_ALLOWED',
      );
      denied(
        await as(app, mod).patch(`/api/users/${member2.id}`).send({ bio: '' }),
      );
    });
    it('member ні', async () => {
      denied(
        await as(app, member).delete(`/api/users/${member2.id}/avatar`),
        'NOT_ALLOWED',
      );
    });
  });

  describe('Понизити чи заблокувати модератора', () => {
    it('admin так', async () => {
      allowed(
        await as(app, admin)
          .patch(`/api/users/${mod2.id}`)
          .send({ role: 'member' }),
      );
      allowed(
        await as(app, admin)
          .patch(`/api/users/${mod2.id}`)
          .send({ active: false }),
      );
    });
    it('moderator ні', async () => {
      denied(
        await as(app, mod)
          .patch(`/api/users/${mod2.id}`)
          .send({ role: 'member' }),
      );
      denied(
        await as(app, mod)
          .patch(`/api/users/${mod2.id}`)
          .send({ active: false }),
        'TARGET_ROLE_FORBIDDEN',
      );
    });
    it('member ні', async () => {
      denied(
        await as(app, member)
          .patch(`/api/users/${mod2.id}`)
          .send({ active: false }),
      );
    });
  });

  describe('Створити учасника з паролем', () => {
    const body = () => ({
      email: `new-${Math.random().toString(36).slice(2)}@test.local`,
      name: 'Новий учасник',
      password: 'password-123',
    });
    it('admin так', async () => {
      const res = await as(app, admin).post('/api/users').send(body());
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('member');
    });
    it('moderator так: створює лише member, пише в аудит', async () => {
      const res = await as(app, mod).post('/api/users').send(body());
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('member');
      expect(await audit('user.created', res.body.id)).toMatchObject({
        actorId: mod.id,
      });
    });
    it('member ні', async () => {
      denied(await as(app, member).post('/api/users').send(body()));
    });
  });

  describe('Заблокувати (вигнати) учасника', () => {
    it('admin так', async () => {
      allowed(
        await as(app, admin)
          .patch(`/api/users/${member2.id}`)
          .send({ active: false }),
      );
    });
    it('moderator так, лише member; дія в аудиті, сесія заблокованого гасне', async () => {
      allowed(
        await as(app, mod)
          .patch(`/api/users/${member2.id}`)
          .send({ active: false }),
      );
      expect(await audit('user.updated', member2.id)).toMatchObject({
        actorId: mod.id,
      });
      expect((await as(app, member2).get('/api/auth/me')).status).toBe(401);
    });
    it('moderator не блокує адміна', async () => {
      denied(
        await as(app, mod)
          .patch(`/api/users/${admin.id}`)
          .send({ active: false }),
        'TARGET_ROLE_FORBIDDEN',
      );
    });
    it('moderator не діє над собою через /users/:id', async () => {
      denied(
        await as(app, mod)
          .patch(`/api/users/${mod.id}`)
          .send({ active: false }),
        'SELF_ACTION_FORBIDDEN',
      );
    });
    it('member ні', async () => {
      denied(
        await as(app, member)
          .patch(`/api/users/${member2.id}`)
          .send({ active: false }),
      );
    });
  });

  describe('Підвищити member до moderator', () => {
    it('admin так', async () => {
      allowed(
        await as(app, admin)
          .patch(`/api/users/${member2.id}`)
          .send({ role: 'moderator' }),
      );
    });
    it('moderator так', async () => {
      const res = await as(app, mod)
        .patch(`/api/users/${member2.id}`)
        .send({ role: 'moderator' });
      allowed(res);
      expect(res.body.role).toBe('moderator');
    });
    it('member ні', async () => {
      denied(
        await as(app, member)
          .patch(`/api/users/${member2.id}`)
          .send({ role: 'moderator' }),
      );
    });
    it('роль guest більше не приймається', async () => {
      const res = await as(app, admin)
        .patch(`/api/users/${member2.id}`)
        .send({ role: 'guest' });
      expect(res.status).toBe(400);
    });
  });

  describe('Змінити спеціальність і посаду іншого', () => {
    const body = { specialty: 'Звук', position: 'Звукорежисер' };
    it('admin так (і для модератора)', async () => {
      allowed(await as(app, admin).patch(`/api/users/${mod2.id}`).send(body));
    });
    it('moderator так для member', async () => {
      const res = await as(app, mod)
        .patch(`/api/users/${member2.id}`)
        .send(body);
      allowed(res);
      expect(res.body).toMatchObject(body);
    });
    it('moderator ні для модератора чи адміна', async () => {
      denied(
        await as(app, mod).patch(`/api/users/${mod2.id}`).send(body),
        'TARGET_ROLE_FORBIDDEN',
      );
      denied(
        await as(app, mod).patch(`/api/users/${admin.id}`).send(body),
        'TARGET_ROLE_FORBIDDEN',
      );
    });
    it('member ні', async () => {
      denied(
        await as(app, member).patch(`/api/users/${member2.id}`).send(body),
      );
    });
  });

  describe('Змінити своє біо й аватар', () => {
    it.each([
      ['admin', () => admin],
      ['moderator', () => mod],
      ['member', () => member],
    ])('%s так', async (_r, who) => {
      const u = who();
      allowed(
        await as(app, u).patch('/api/users/me').send({ bio: 'Нове біо' }),
      );
      const up = await as(app, u)
        .post(`/api/users/${u.id}/avatar`)
        .attach('file', PNG_1PX, 'a.png');
      expect(up.status).toBe(201);
      // Адреса під /api з версією: новий аватар не береться з кешу браузера.
      expect(up.body.avatarUrl).toMatch(
        new RegExp(`^/api/files/avatars/${u.id}\\?v=\\d+$`),
      );
      const img = await as(app, u).get(up.body.avatarUrl as string);
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toBe('image/png');
      allowed(await as(app, u).delete(`/api/users/${u.id}/avatar`));
    });
    it('member не змінює собі ім’я, посаду, спеціальність', async () => {
      for (const field of ['name', 'position', 'specialty']) {
        denied(
          await as(app, member)
            .patch('/api/users/me')
            .send({ [field]: 'Інше' }),
          'FIELD_NOT_ALLOWED',
        );
      }
    });
    it('member може надіслати незмінене ім’я разом із біо', async () => {
      allowed(
        await as(app, member)
          .patch('/api/users/me')
          .send({ name: member.name, bio: 'Ок' }),
      );
    });
    it('moderator змінює собі посаду, але не ім’я', async () => {
      allowed(
        await as(app, mod).patch('/api/users/me').send({ position: 'Лід' }),
      );
      denied(
        await as(app, mod).patch('/api/users/me').send({ name: 'Інше' }),
        'FIELD_NOT_ALLOWED',
      );
    });
    it('admin змінює собі ім’я', async () => {
      allowed(
        await as(app, admin).patch('/api/users/me').send({ name: 'Адмін' }),
      );
    });
    it('чужий аватар не завантажує ніхто, навіть admin', async () => {
      const res = await as(app, admin)
        .post(`/api/users/${member2.id}/avatar`)
        .attach('file', PNG_1PX, 'a.png');
      denied(res, 'NOT_ALLOWED');
    });
  });

  describe('Бали, штрафи, догани, попередження', () => {
    const award = (who: TestUser, to: TestUser) =>
      as(app, who)
        .post('/api/points/award')
        .send({ userId: to.id, amount: 5, reason: 'чергування' });
    const warn = (who: TestUser, to: TestUser) =>
      as(app, who)
        .post('/api/discipline')
        .send({ userId: to.id, type: 'warning', reason: 'запізнення' });

    it('admin так (навіть модератору)', async () => {
      expect((await award(admin, member)).status).toBe(201);
      expect((await warn(admin, mod)).status).toBe(201);
    });
    it('moderator так, і іншому модератору', async () => {
      expect((await award(mod, member)).status).toBe(201);
      expect((await award(mod, mod2)).status).toBe(201);
      expect((await warn(mod, mod2)).status).toBe(201);
      expect((await warn(mod, admin)).status).toBe(201);
    });
    it('moderator не собі', async () => {
      denied(await award(mod, mod), 'SELF_ACTION_FORBIDDEN');
      denied(await warn(mod, mod), 'SELF_ACTION_FORBIDDEN');
    });
    it('member ні', async () => {
      denied(await award(member, member2));
      denied(await warn(member, member2));
    });
    it('пишеться в аудит', async () => {
      const r = await warn(mod, member);
      expect(await audit('discipline.issued', member.id)).toMatchObject({
        actorId: mod.id,
        meta: { recordId: r.body.id },
      });
    });
  });

  describe('Зняти такий запис', () => {
    const issue = async (who: TestUser) =>
      (
        await as(app, who)
          .post('/api/discipline')
          .send({ userId: member.id, type: 'reprimand', reason: 'r' })
      ).body as { id: string };
    const revoke = (who: TestUser, id: string, reason = 'помилка') =>
      as(app, who).post(`/api/discipline/${id}/revoke`).send({ reason });

    it('admin знімає будь-який', async () => {
      const r = await issue(mod);
      allowed(await revoke(admin, r.id));
    });
    it('moderator лише свій', async () => {
      const own = await issue(mod);
      allowed(await revoke(mod, own.id));
      const other = await issue(mod2);
      denied(await revoke(mod, other.id), 'NOT_OWNER');
    });
    it('без причини не можна', async () => {
      const r = await issue(mod);
      const res = await revoke(mod, r.id, '   ');
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });
    it('member ні', async () => {
      const r = await issue(mod);
      denied(await revoke(member, r.id));
    });
    it('нарахування балів: moderator лише своє', async () => {
      const own = await as(app, mod)
        .post('/api/points/award')
        .send({ userId: member.id, amount: 3, reason: 'x' });
      const other = await as(app, mod2)
        .post('/api/points/award')
        .send({ userId: member.id, amount: 3, reason: 'x' });
      denied(
        await as(app, mod)
          .post(`/api/points/${other.body.id}/revoke`)
          .send({ reason: 'r' }),
        'NOT_OWNER',
      );
      allowed(
        await as(app, mod)
          .post(`/api/points/${own.body.id}/revoke`)
          .send({ reason: 'r' }),
      );
      denied(
        await as(app, member)
          .post(`/api/points/${other.body.id}/revoke`)
          .send({ reason: 'r' }),
      );
    });
  });

  describe('Створити ТЗ, проєкт', () => {
    const task = { title: 'ТЗ', points: 10 };
    const project = { title: 'Проєкт' };
    it('admin так', async () => {
      expect((await as(app, admin).post('/api/tasks').send(task)).status).toBe(
        201,
      );
      expect(
        (await as(app, admin).post('/api/projects').send(project)).status,
      ).toBe(201);
    });
    it('moderator так', async () => {
      expect((await as(app, mod).post('/api/tasks').send(task)).status).toBe(
        201,
      );
      expect(
        (await as(app, mod).post('/api/projects').send(project)).status,
      ).toBe(201);
    });
    it('member ні', async () => {
      denied(await as(app, member).post('/api/tasks').send(task));
      denied(await as(app, member).post('/api/projects').send(project));
    });
  });

  describe("Взяти ТЗ і здати на рев'ю", () => {
    const newTask = async (max = 3) =>
      (
        await as(app, admin)
          .post('/api/tasks')
          .send({ title: 'ТЗ', points: 10, maxAssignees: max })
      ).body.id as string;

    it('admin, moderator, member самі беруть вільне ТЗ', async () => {
      const id = await newTask();
      for (const u of [admin, mod, member]) {
        allowed(await as(app, u).post(`/api/tasks/${id}/take`));
      }
    });
    it('виконавець здає, сторонній ні', async () => {
      const id = await newTask();
      await as(app, member).post(`/api/tasks/${id}/take`);
      denied(
        await as(app, member2).post(`/api/tasks/${id}/start`),
        'NOT_PARTICIPANT',
      );
      allowed(await as(app, member).post(`/api/tasks/${id}/start`));
      denied(
        await as(app, member2).post(`/api/tasks/${id}/submit`),
        'NOT_PARTICIPANT',
      );
      denied(
        await as(app, admin).post(`/api/tasks/${id}/submit`),
        'NOT_PARTICIPANT',
      );
      allowed(await as(app, member).post(`/api/tasks/${id}/submit`));
    });
  });

  describe('Прийняти ТЗ (нарахування балів)', () => {
    /** Task in review with the given assignee. */
    const inReview = async (assignee: TestUser) => {
      const id = (
        await as(app, admin)
          .post('/api/tasks')
          .send({ title: 'ТЗ', points: 10 })
      ).body.id as string;
      for (const step of ['take', 'start', 'submit']) {
        allowed(await as(app, assignee).post(`/api/tasks/${id}/${step}`));
      }
      return id;
    };
    const accept = (who: TestUser, id: string) =>
      as(app, who).post(`/api/tasks/${id}/accept`);

    it('admin так', async () => {
      allowed(await accept(admin, await inReview(member)));
    });
    it('moderator так, не своє', async () => {
      allowed(await accept(mod, await inReview(member)));
      denied(await accept(mod, await inReview(mod)), 'SELF_ACTION_FORBIDDEN');
    });
    it('moderator не повертає своє на допрацювання', async () => {
      const id = await inReview(mod);
      denied(
        await as(app, mod).post(`/api/tasks/${id}/return`).send({ body: 'ні' }),
        'SELF_ACTION_FORBIDDEN',
      );
    });
    it('member ні (навіть своє)', async () => {
      denied(await accept(member, await inReview(member)));
    });
  });

  describe('Оновити етап і прогрес проєкту', () => {
    let projectId: string;
    beforeEach(async () => {
      const p = await as(app, admin)
        .post('/api/projects')
        .send({ title: 'Проєкт', memberIds: [member.id] });
      projectId = p.body.id;
    });
    const update = (who: TestUser) =>
      as(app, who)
        .patch(`/api/projects/${projectId}`)
        .send({ stage: 'execution', progress: 50 });

    it('admin так', async () => {
      allowed(await update(admin));
    });
    it('moderator так', async () => {
      allowed(await update(mod));
    });
    it('member якщо учасник', async () => {
      allowed(await update(member));
      denied(await update(member2), 'PROJECT_EDIT_FORBIDDEN');
    });
    it('member не змінює склад учасників', async () => {
      denied(
        await as(app, member)
          .patch(`/api/projects/${projectId}`)
          .send({ memberIds: [member.id, member2.id] }),
        'PROJECT_MEMBERS_FORBIDDEN',
      );
    });
  });

  describe('Документи, обладнання, довідник складу', () => {
    let n = 0;
    const doc = (who: TestUser) =>
      as(app, who)
        .post('/api/documents')
        .field('title', 'Інструкція')
        .field('category', 'Інструкції')
        .attach('file', Buffer.from('текст'), 'a.txt');
    const place = (who: TestUser) =>
      as(app, who)
        .post('/api/places')
        .send({ code: `PLACE-${++n}`, title: 'Лазер', category: 'Верстати' });
    const item = (who: TestUser) =>
      as(app, who)
        .post('/api/inventory/items')
        .send({ code: `ITEM-${++n}`, title: 'Фанера', category: 'Матеріали' });

    it('admin так', async () => {
      expect((await doc(admin)).status).toBe(201);
      expect((await place(admin)).status).toBe(201);
      expect((await item(admin)).status).toBe(201);
    });
    it('moderator так, включно з архівуванням', async () => {
      const d = await doc(mod);
      expect(d.status).toBe(201);
      allowed(await as(app, mod).delete(`/api/documents/${d.body.id}`));
      expect((await place(mod)).status).toBe(201);
      expect((await item(mod)).status).toBe(201);
    });
    it('member лише перегляд', async () => {
      denied(await doc(member));
      denied(await place(member));
      denied(await item(member));
      allowed(await as(app, member).get('/api/documents'));
      allowed(await as(app, member).get('/api/places'));
      allowed(await as(app, member).get('/api/inventory/items'));
    });
  });

  describe('Видати допуск до обладнання', () => {
    let placeId: string;
    beforeEach(async () => {
      const p = await as(app, admin).post('/api/places').send({
        code: 'LASER-1',
        title: 'Лазер',
        category: 'Верстати',
        needsAuthorization: true,
      });
      placeId = p.body.id;
    });
    const grant = (who: TestUser) =>
      as(app, who)
        .post('/api/place-authorizations')
        .send({ userId: member2.id, placeId });

    it('admin так', async () => {
      expect((await grant(admin)).status).toBe(201);
    });
    it('moderator так', async () => {
      expect((await grant(mod)).status).toBe(201);
    });
    it('member ні', async () => {
      denied(await grant(member));
    });
  });

  describe('Склад: взяти або поповнити', () => {
    let itemId: string;
    beforeEach(async () => {
      const i = await as(app, admin).post('/api/inventory/items').send({
        code: 'ITEM-1',
        title: 'Фанера',
        category: 'Матеріали',
        quantity: 10,
      });
      itemId = i.body.id;
    });
    it.each([
      ['admin', () => admin],
      ['moderator', () => mod],
      ['member', () => member],
    ])('%s так: взяти і поповнити', async (_r, who) => {
      const u = who();
      const move = (delta: number) =>
        as(app, u)
          .post(`/api/inventory/items/${itemId}/movements`)
          .send({ delta, note: 'тест' });
      expect((await move(-1)).status).toBe(201);
      expect((await move(2)).status).toBe(201);
    });
    it('позиція відкривається за кодом з наліпки (без різниці в регістрі)', async () => {
      const byCode = await as(app, member)
        .get('/api/inventory/items/item-1')
        .expect(200);
      expect(byCode.body).toMatchObject({ id: itemId, code: 'ITEM-1' });
      expect(byCode.body.documents).toEqual([]);
      await as(app, member).get('/api/inventory/items/NOPE-9').expect(404);
      await as(app, member).get(`/api/inventory/items/${itemId}`).expect(200);
    });
  });

  describe('Сеанс роботи з обладнанням', () => {
    let placeId: string;
    beforeEach(async () => {
      const p = await as(app, admin).post('/api/places').send({
        code: 'LASER-1',
        title: 'Лазер',
        category: 'Верстати',
        needsAuthorization: true,
      });
      placeId = p.body.id;
    });
    const start = (who: TestUser) =>
      as(app, who)
        .post(`/api/places/${placeId}/sessions`)
        .send({ safetyConfirmed: true });

    it('admin так', async () => {
      expect((await start(admin)).status).toBe(201);
    });
    it('moderator так', async () => {
      expect((await start(mod)).status).toBe(201);
    });
    it('member лише з допуском', async () => {
      denied(await start(member), 'NOT_AUTHORIZED_FOR_PLACE');
      await as(app, mod)
        .post('/api/place-authorizations')
        .send({ userId: member.id, placeId })
        .expect(201);
      expect((await start(member)).status).toBe(201);
    });
  });

  describe('Завершити чужий сеанс', () => {
    let sessionId: string;
    beforeEach(async () => {
      const p = await as(app, admin).post('/api/places').send({
        code: 'PRINTER-1',
        title: 'Принтер',
        category: 'Друк',
        needsAuthorization: false,
      });
      const s = await as(app, member2)
        .post(`/api/places/${p.body.id}/sessions`)
        .send({ safetyConfirmed: true });
      sessionId = s.body.id;
    });
    const end = (who: TestUser, reason?: string) =>
      as(app, who)
        .patch(`/api/work-sessions/${sessionId}/end`)
        .send(reason ? { reason } : {});

    it('admin так, з причиною', async () => {
      allowed(await end(admin, 'забув вимкнути'));
    });
    it('moderator так, з причиною', async () => {
      const no = await end(mod);
      expect(no.status).toBe(400);
      expect(no.body.errorCode).toBe('REASON_REQUIRED');
      allowed(await end(mod, 'забув вимкнути'));
    });
    it('member ні', async () => {
      denied(await end(member, 'хочу'), 'NOT_YOUR_SESSION');
    });
  });

  describe('Бронювання', () => {
    let placeId: string;
    beforeEach(async () => {
      const p = await as(app, admin).post('/api/places').send({
        code: 'CAM-1',
        title: 'Камера',
        category: 'Відео',
        needsAuthorization: false,
      });
      placeId = p.body.id;
    });
    let slot = 0;
    const book = async (who: TestUser) => {
      // Each booking gets its own hour, so they never overlap.
      const start = Date.now() + (24 + slot++) * 3600_000;
      const res = await as(app, who)
        .post('/api/bookings')
        .send({
          placeId,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(start + 3600_000).toISOString(),
        });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const cancel = (who: TestUser, id: string, reason?: string) =>
      as(app, who)
        .post(`/api/bookings/${id}/cancel`)
        .send(reason ? { reason } : {});

    it('admin скасовує будь-яке (з причиною)', async () => {
      const id = await book(member);
      allowed(await cancel(admin, id, 'ремонт'));
    });
    it('moderator скасовує будь-яке, чуже лише з причиною', async () => {
      const id = await book(member);
      const res = await cancel(mod, id);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('REASON_REQUIRED');
      allowed(await cancel(mod, id, 'захід'));
      expect(await audit('booking.cancelled', id)).toMatchObject({
        actorId: mod.id,
        meta: { forced: true, userId: member.id },
      });
    });
    it('member — своє так, чуже ні', async () => {
      allowed(await cancel(member, await book(member)));
      denied(await cancel(member, await book(member2)), 'NOT_OWNER');
    });
    it('member бронює лише з допуском', async () => {
      const p = await as(app, admin).post('/api/places').send({
        code: 'LASER-B',
        title: 'Лазер',
        category: 'Верстати',
        needsAuthorization: true,
      });
      const start = Date.now() + 48 * 3600_000;
      const body = {
        placeId: p.body.id,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 3600_000).toISOString(),
      };
      denied(
        await as(app, member).post('/api/bookings').send(body),
        'NOT_AUTHORIZED_FOR_PLACE',
      );
      expect((await as(app, mod).post('/api/bookings').send(body)).status).toBe(
        201,
      );
    });
  });

  describe('Звіт про несправність', () => {
    let placeId: string;
    beforeEach(async () => {
      const p = await as(app, admin).post('/api/places').send({
        code: 'PRN-1',
        title: 'Принтер',
        category: 'Друк',
      });
      placeId = p.body.id;
    });
    const report = async (who: TestUser) => {
      const res = await as(app, who)
        .post('/api/faults')
        .send({ placeId, description: 'Не вмикається' });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const close = (who: TestUser, id: string) =>
      as(app, who)
        .post(`/api/faults/${id}/close`)
        .send({ resolution: 'Замінили' });

    it('усі створюють', async () => {
      for (const u of [admin, mod, member]) await report(u);
    });
    it('admin і moderator закривають', async () => {
      allowed(await close(admin, await report(member)));
      allowed(await close(mod, await report(member)));
    });
    it('member не закриває і не ставить на обслуговування', async () => {
      const id = await report(member);
      denied(await close(member, id));
      denied(await as(app, member).post(`/api/faults/${id}/maintenance`));
    });
    it('фото: автор так, інший member ні', async () => {
      const id = await report(member);
      const up = (who: TestUser) =>
        as(app, who)
          .post(`/api/faults/${id}/photos`)
          .attach('file', PNG_1PX, 'f.png');
      expect((await up(member)).status).toBe(201);
      denied(await up(member2), 'NOT_OWNER');
      expect((await up(mod)).status).toBe(201);
    });
  });

  describe('Вивантаження журналу', () => {
    it('admin і moderator так, member ні', async () => {
      allowed(await as(app, admin).get('/api/work-sessions/export.csv'));
      allowed(await as(app, mod).get('/api/work-sessions/report'));
      denied(await as(app, member).get('/api/work-sessions/export.csv'));
      denied(await as(app, member).get('/api/work-sessions/report'));
    });
  });

  describe('Розумні пристрої: керувати / список дозволених', () => {
    const light = '00000000-0000-4000-8000-000000000000';
    const control = (who: TestUser) =>
      as(app, who).post(`/api/smart/lights/${light}/state`).send({ on: true });

    it('admin: керувати так, список так', async () => {
      expect((await control(admin)).status).not.toBe(403);
      allowed(await as(app, admin).get('/api/smart/allowlist'));
    });
    it('moderator: керувати так, список ні', async () => {
      expect((await control(mod)).status).not.toBe(403);
      denied(await as(app, mod).get('/api/smart/allowlist'));
    });
    it('member: перегляд, список ні', async () => {
      allowed(await as(app, member).get('/api/smart/entities'));
      denied(await control(member));
      denied(await as(app, member).get('/api/smart/allowlist'));
    });
  });

  describe('Розширений перегляд учасників', () => {
    it('admin і moderator бачать email, member ні', async () => {
      const a = await as(app, mod).get(`/api/users/${member2.id}`);
      expect(a.body.email).toBe(member2.email);
      const b = await as(app, member).get(`/api/users/${member2.id}`);
      expect(b.body.email).toBeUndefined();
    });
    it('member бачить публічну картку: з біо й балами, без приватного', async () => {
      await as(app, member2).patch('/api/users/me').send({ bio: 'Про мене' });
      const one = await as(app, member).get(`/api/users/${member2.id}`);
      expect(Object.keys(one.body).sort()).toEqual(
        [
          'avatarUrl',
          'bio',
          'id',
          'name',
          'pointsTotal',
          'position',
          'role',
          'specialty',
        ].sort(),
      );
      expect(one.body.bio).toBe('Про мене');
      const list = await as(app, member).get('/api/users');
      const card = (list.body.items as { id: string }[]).find(
        (u) => u.id === member2.id,
      );
      expect(card).toMatchObject({ bio: 'Про мене' });
      expect(card).not.toHaveProperty('email');
      expect(card).not.toHaveProperty('active');
    });
    it('/auth/me віддає permissions з політики', async () => {
      const res = await as(app, mod).get('/api/auth/me').expect(200);
      expect(res.body.role).toBe('moderator');
      expect(res.body.permissions).toContain('users.create');
      expect(res.body.permissions).not.toContain('audit.read');
    });
  });

  describe('Без входу', () => {
    it('захищені маршрути відповідають 401', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });
  });
});
