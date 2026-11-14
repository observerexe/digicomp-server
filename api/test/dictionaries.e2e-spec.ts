import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { DictionaryUsageRegistry } from '../src/dictionaries/dictionary-usage';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

type Item = { key: string; title: string; color: string; archived: boolean };
type Dict = { key: string; title: string; required: boolean; items: Item[] };

describe('Довідники (e2e)', () => {
  let app: INestApplication<App>;
  let mod: TestUser;
  let member: TestUser;
  // Fake module: "uses" the item key "used" and relies on dictionary "locked".
  const used = new Set<string>();

  beforeAll(async () => {
    app = await createTestApp();
    app.get(DictionaryUsageRegistry).register({
      dictionaries: ['locked'],
      countItem: (_d, item) => Promise.resolve(used.has(item) ? 1 : 0),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    used.clear();
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
  });

  const audit = (action: string) =>
    app.get(DataSource).getRepository(AuditLog).findBy({ action });

  async function dict(title = 'Тип ТЗ') {
    const res = await as(app, mod).post('/api/dictionaries').send({ title });
    expect(res.status).toBe(201);
    return res.body as Dict;
  }

  async function item(key: string, title: string, color?: string) {
    const res = await as(app, mod)
      .post(`/api/dictionaries/${key}/items`)
      .send({ title, color });
    expect(res.status).toBe(201);
    return res.body as Item;
  }

  it('створення: ключ з назви, пункти в порядку додавання, аудит', async () => {
    const d = await dict('Тип ТЗ');
    expect(d).toMatchObject({ key: 'typ_tz', title: 'Тип ТЗ', items: [] });
    await item('typ_tz', 'Дизайн', 'purple');
    await item('typ_tz', 'Відео');
    const res = await as(app, member).get('/api/dictionaries/typ_tz');
    expect(res.status).toBe(200);
    expect((res.body as Dict).items).toEqual([
      expect.objectContaining({ key: 'dyzain', color: 'purple', position: 0 }),
      expect.objectContaining({ key: 'video', color: 'gray', position: 1 }),
    ]);
    expect(await audit('dictionary.created')).toHaveLength(1);
    expect(await audit('dictionary.item_created')).toHaveLength(2);
  });

  it('перейменування не змінює ключ', async () => {
    await dict('Тип ТЗ');
    await item('typ_tz', 'Дизайн');
    const d = await as(app, mod)
      .patch('/api/dictionaries/typ_tz')
      .send({ title: 'Вид роботи' });
    expect(d.body).toMatchObject({ key: 'typ_tz', title: 'Вид роботи' });
    const i = await as(app, mod)
      .patch('/api/dictionaries/typ_tz/items/dyzain')
      .send({ title: 'Графіка', color: 'blue' });
    expect(i.body).toMatchObject({ key: 'dyzain', title: 'Графіка' });
    const [log] = await audit('dictionary.item_updated');
    expect(log.meta).toMatchObject({
      title: { from: 'Дизайн', to: 'Графіка' },
      color: { from: 'gray', to: 'blue' },
    });
  });

  it('однакова назва (без різниці регістру) — DICTIONARY_DUPLICATE', async () => {
    await dict('Тип ТЗ');
    const d = await as(app, mod)
      .post('/api/dictionaries')
      .send({ title: ' тип тз ' });
    expect(d.status).toBe(409);
    expect(d.body.errorCode).toBe('DICTIONARY_DUPLICATE');
    await item('typ_tz', 'Дизайн');
    const i = await as(app, mod)
      .post('/api/dictionaries/typ_tz/items')
      .send({ title: 'ДИЗАЙН' });
    expect(i.status).toBe(409);
    expect(i.body.errorCode).toBe('DICTIONARY_DUPLICATE');
  });

  it('колір лише з палітри, назва не порожня', async () => {
    await dict();
    for (const body of [{ title: 'А', color: '#ff0000' }, { title: '   ' }]) {
      const res = await as(app, mod)
        .post('/api/dictionaries/typ_tz/items')
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    }
  });

  it('архів і повернення', async () => {
    await dict();
    await item('typ_tz', 'Дизайн');
    const a = await as(app, mod)
      .patch('/api/dictionaries/typ_tz/items/dyzain')
      .send({ archived: true });
    expect(a.body).toMatchObject({ archived: true });
    const b = await as(app, mod)
      .patch('/api/dictionaries/typ_tz/items/dyzain')
      .send({ archived: false });
    expect(b.body).toMatchObject({ archived: false });
  });

  it('новий порядок: лише повний список ключів', async () => {
    await dict();
    await item('typ_tz', 'Дизайн');
    await item('typ_tz', 'Відео');
    const bad = await as(app, mod)
      .put('/api/dictionaries/typ_tz/items/order')
      .send({ keys: ['video'] });
    expect(bad.status).toBe(400);
    const res = await as(app, mod)
      .put('/api/dictionaries/typ_tz/items/order')
      .send({ keys: ['video', 'dyzain'] });
    expect(res.status).toBe(200);
    expect((res.body as Dict).items.map((i) => i.key)).toEqual([
      'video',
      'dyzain',
    ]);
    expect(await audit('dictionary.items_reordered')).toHaveLength(1);
  });

  it('пункт, що використовується, не видаляється — DICTIONARY_ITEM_IN_USE', async () => {
    await dict();
    await item('typ_tz', 'Дизайн');
    used.add('dyzain');
    const res = await as(app, mod).delete(
      '/api/dictionaries/typ_tz/items/dyzain',
    );
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('DICTIONARY_ITEM_IN_USE');
    used.clear();
    const ok = await as(app, mod).delete(
      '/api/dictionaries/typ_tz/items/dyzain',
    );
    expect(ok.status).toBe(200);
    expect(await audit('dictionary.item_deleted')).toHaveLength(1);
  });

  it('довідник з пунктами не видаляється — DICTIONARY_NOT_EMPTY', async () => {
    await dict();
    await item('typ_tz', 'Дизайн');
    const res = await as(app, mod).delete('/api/dictionaries/typ_tz');
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('DICTIONARY_NOT_EMPTY');
    await as(app, mod).delete('/api/dictionaries/typ_tz/items/dyzain');
    const ok = await as(app, mod).delete('/api/dictionaries/typ_tz');
    expect(ok.status).toBe(200);
    expect(await audit('dictionary.deleted')).toHaveLength(1);
    const gone = await as(app, mod).get('/api/dictionaries/typ_tz');
    expect(gone.body.errorCode).toBe('DICTIONARY_NOT_FOUND');
  });

  it('довідник, на який спирається модуль, не видаляється — DICTIONARY_IN_USE', async () => {
    const d = await dict('Locked');
    expect(d).toMatchObject({ key: 'locked', required: true });
    const res = await as(app, mod).delete('/api/dictionaries/locked');
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('DICTIONARY_IN_USE');
  });

  it('невідомий пункт — DICTIONARY_ITEM_NOT_FOUND', async () => {
    await dict();
    const res = await as(app, mod)
      .patch('/api/dictionaries/typ_tz/items/nope')
      .send({ title: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('DICTIONARY_ITEM_NOT_FOUND');
  });
});
