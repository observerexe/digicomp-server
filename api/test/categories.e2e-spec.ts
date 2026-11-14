import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { Role } from '../src/users/user.entity';
import {
  as,
  category,
  createTestApp,
  makeUser,
  resetDb,
  TestUser,
} from './helpers';

// Категорії обладнання, архіву й складу — пункти довідників.

describe('Категорії з довідників (e2e)', () => {
  let app: INestApplication<App>;
  let mod: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
  });

  const archive = (dict: string, key: string, archived = true) =>
    as(app, mod)
      .patch(`/api/dictionaries/${dict}/items/${key}`)
      .send({ archived })
      .expect(200);

  const place = (code: string, category: string) =>
    as(app, mod).post('/api/places').send({ code, title: 'Фрезер', category });
  const doc = (category: string) =>
    as(app, mod)
      .post('/api/documents')
      .field('title', 'Інструкція')
      .field('category', category)
      .attach('file', Buffer.from('текст'), 'a.txt');
  const item = (code: string, category: string) =>
    as(app, mod)
      .post('/api/inventory/items')
      .send({ code, title: 'Фанера', category });

  it('приймає лише наявний неархівний пункт свого довідника', async () => {
    await category(app, 'place_category', 'Верстати');
    await category(app, 'document_category', 'Інструкції');
    await category(app, 'inventory_category', 'Матеріали');

    expect((await place('CNC-1', 'verstaty')).status).toBe(201);
    expect((await doc('instruktsii')).status).toBe(201);
    expect((await item('PLY-1', 'materialy')).status).toBe(201);

    for (const res of [
      await place('CNC-2', 'nemaie'),
      // Ключ іншого довідника не підходить.
      await place('CNC-3', 'instruktsii'),
      await doc('verstaty'),
      await item('PLY-2', 'Матеріали'),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('DICTIONARY_ITEM_INVALID');
    }
  });

  it('архівний пункт лишається в старих записах, але не вибирається', async () => {
    await category(app, 'place_category', 'Верстати');
    await category(app, 'place_category', 'Друк');
    const p = (await place('CNC-1', 'verstaty').expect(201)).body as {
      id: string;
    };
    await archive('place_category', 'verstaty');

    const res = await place('CNC-2', 'verstaty');
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('DICTIONARY_ITEM_INVALID');

    // Інші поля зберігаються, і та сама категорія теж.
    await as(app, mod)
      .patch(`/api/places/${p.id}`)
      .send({ title: 'Фрезер 2', category: 'verstaty' })
      .expect(200);
    await as(app, mod)
      .patch(`/api/places/${p.id}`)
      .send({ category: 'druk' })
      .expect(200);
    const back = await as(app, mod)
      .patch(`/api/places/${p.id}`)
      .send({ category: 'verstaty' });
    expect(back.status).toBe(400);
    expect(back.body.errorCode).toBe('DICTIONARY_ITEM_INVALID');
  });

  it('використаний пункт і довідник категорій не видаляються', async () => {
    await category(app, 'document_category', 'Інструкції');
    await category(app, 'document_category', 'Паспорти');
    await doc('instruktsii').expect(201);

    const used = await as(app, mod).delete(
      '/api/dictionaries/document_category/items/instruktsii',
    );
    expect(used.status).toBe(409);
    expect(used.body.errorCode).toBe('DICTIONARY_ITEM_IN_USE');
    await as(app, mod)
      .delete('/api/dictionaries/document_category/items/pasporty')
      .expect(200);

    for (const key of [
      'place_category',
      'document_category',
      'inventory_category',
    ]) {
      await category(app, key as 'place_category', 'Тимчасова');
      const d = await as(app, member).get(`/api/dictionaries/${key}`);
      expect(d.body.required).toBe(true);
    }
    await as(app, mod)
      .delete('/api/dictionaries/place_category/items/tymchasova')
      .expect(200);
    const res = await as(app, mod).delete('/api/dictionaries/place_category');
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('DICTIONARY_IN_USE');
  });

  it('пошук знаходить за назвою категорії, а не за ключем', async () => {
    await category(app, 'place_category', 'Верстати');
    await category(app, 'document_category', 'Паспорти');
    await category(app, 'inventory_category', 'Матеріали');
    await place('CNC-1', 'verstaty').expect(201);
    await doc('pasporty').expect(201);
    await item('PLY-1', 'materialy').expect(201);

    const count = async (url: string) => {
      const res = await as(app, member).get(url).expect(200);
      const body = res.body as unknown[] | { items: unknown[] };
      return Array.isArray(body) ? body.length : body.items.length;
    };
    expect(await count('/api/places?search=верстат')).toBe(1);
    expect(await count('/api/places?search=verstaty')).toBe(0);
    expect(await count('/api/documents?search=паспорт')).toBe(1);
    expect(await count('/api/documents?search=pasporty')).toBe(0);
    expect(await count('/api/inventory/items?search=матеріал')).toBe(1);
    expect(await count('/api/inventory/items?search=materialy')).toBe(0);
    // Фільтр — за ключем.
    expect(await count('/api/places?category=verstaty')).toBe(1);
  });

  it('експорт складу містить назву категорії', async () => {
    await category(app, 'inventory_category', 'Матеріали');
    await item('PLY-1', 'materialy').expect(201);
    const res = await as(app, mod).get('/api/inventory/export').expect(200);
    const text = Buffer.isBuffer(res.body)
      ? res.body.toString('utf8')
      : res.text;
    expect(text).toContain('PLY-1,Фанера,Матеріали,');
  });
});
