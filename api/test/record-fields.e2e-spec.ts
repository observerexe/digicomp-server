import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/audit/audit-log.entity';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

// Додаткові поля записів (0.3а): визначення в record_field_defs, значення в tasks.extra.

type FieldDef = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  archived: boolean;
  position: number;
};
type Field = { key: string; source?: string; archived?: boolean };

describe('Додаткові поля (e2e)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
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
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    // «Тип ТЗ»: dyzain, video. «Теги»: urgent, team.
    for (const [title, items] of [
      ['Тип ТЗ', ['Дизайн', 'Відео']],
      ['Теги', ['Urgent', 'Team']],
    ] as const) {
      const d = await as(app, mod).post('/api/dictionaries').send({ title });
      for (const t of items) {
        await as(app, mod)
          .post(`/api/dictionaries/${d.body.key}/items`)
          .send({ title: t });
      }
    }
  });

  const audit = (action: string) =>
    app.get(DataSource).getRepository(AuditLog).findBy({ action });

  async function field(body: Record<string, unknown>, by = mod) {
    const res = await as(app, by)
      .post('/api/records/task/field-defs')
      .send(body);
    expect(res.status).toBe(201);
    return res.body as FieldDef;
  }

  const typeField = () =>
    field({ label: 'Тип', type: 'enum', dictionary: 'typ_tz' });

  function newTask(extra?: Record<string, unknown>) {
    return as(app, mod)
      .post('/api/tasks')
      .send({ title: 'Логотип', points: 10, extra });
  }

  const patchTask = (id: string, extra: Record<string, unknown>) =>
    as(app, mod).patch(`/api/tasks/${id}`).send({ extra });

  it('створення: ключ з назви, поле в схемі, версія схеми змінюється, аудит', async () => {
    const before = await as(app, member).get('/api/records/task/schema');
    expect(before.body.extensible).toBe(true);

    const f = await typeField();
    expect(f).toMatchObject({
      key: 'typ',
      label: 'Тип',
      type: 'enum',
      required: false,
      archived: false,
      position: 0,
    });

    const after = await as(app, member).get('/api/records/task/schema');
    expect(after.body.version).not.toBe(before.body.version);
    const fields = after.body.fields as Field[];
    expect(fields.at(-1)).toMatchObject({
      key: 'typ',
      type: 'enum',
      dictionary: 'typ_tz',
      source: 'extra',
      create: true,
      update: true,
    });

    const list = await as(app, member).get('/api/records/task/field-defs');
    expect(list.status).toBe(200);
    expect((list.body as FieldDef[]).map((d) => d.key)).toEqual(['typ']);
    expect(await audit('record_field.created')).toHaveLength(1);
  });

  it('ключ не збігається з ключами звичайних полів, назва — з їхніми назвами', async () => {
    const f = await field({ label: 'Points', type: 'int' });
    expect(f.key).toBe('points_2');

    const same = await as(app, mod)
      .post('/api/records/task/field-defs')
      .send({ label: 'бали', type: 'int' });
    expect(same.status).toBe(409);
    expect(same.body.errorCode).toBe('FIELD_DEF_DUPLICATE');

    const twice = await as(app, mod)
      .post('/api/records/task/field-defs')
      .send({ label: 'POINTS', type: 'text' });
    expect(twice.body.errorCode).toBe('FIELD_DEF_DUPLICATE');
  });

  it('учасник: читає, але не керує; admin керує', async () => {
    expect(
      (await as(app, member).get('/api/records/task/field-defs')).status,
    ).toBe(200);
    const res = await as(app, member)
      .post('/api/records/task/field-defs')
      .send({ label: 'Тип', type: 'text' });
    expect(res.status).toBe(403);
    await field({ label: 'Складність', type: 'int', min: 1, max: 5 }, admin);
  });

  it('тип без додаткових полів — 404 RECORD_TYPE_NOT_FOUND', async () => {
    const res = await as(app, mod).get('/api/records/place/field-defs');
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('RECORD_TYPE_NOT_FOUND');
    const place = await as(app, member).get('/api/records/place/schema');
    expect(place.body.extensible).toBe(false);
  });

  it('межі мають пасувати типу; довідник має існувати', async () => {
    const post = (body: Record<string, unknown>) =>
      as(app, mod).post('/api/records/task/field-defs').send(body);
    for (const body of [
      { label: 'А', type: 'enum' },
      { label: 'А', type: 'text', dictionary: 'typ_tz' },
      { label: 'А', type: 'text', min: 1 },
      { label: 'А', type: 'int', min: 5, max: 1 },
      { label: 'А', type: 'int', min: 1.5 },
      { label: 'А', type: 'bool', maxLength: 5 },
      { label: 'А', type: 'richtext' },
    ]) {
      const res = await post(body);
      expect([body, res.status, res.body.errorCode]).toEqual([
        body,
        400,
        'VALIDATION_ERROR',
      ]);
    }
    const res = await post({ label: 'А', type: 'enum', dictionary: 'nemaie' });
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('DICTIONARY_NOT_FOUND');
  });

  it('ТЗ: extra у створенні й зміні, null очищає, аудит змін', async () => {
    await typeField();
    await field({ label: 'Складність', type: 'int', min: 1, max: 5 });
    await field({ label: 'Мітки', type: 'list<enum>', dictionary: 'tehy' });

    const created = await newTask({ typ: 'dyzain', skladnist: 3 });
    expect(created.status).toBe(201);
    expect(created.body.extra).toEqual({ typ: 'dyzain', skladnist: 3 });

    const id = created.body.id as string;
    const patched = await patchTask(id, {
      skladnist: null,
      mitky: ['urgent', 'team'],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.extra).toEqual({
      typ: 'dyzain',
      mitky: ['urgent', 'team'],
    });

    const [log] = await audit('task.updated');
    expect(log.meta).toMatchObject({
      extra: { skladnist: null, mitky: ['urgent', 'team'] },
    });

    const got = await as(app, member).get(`/api/tasks/${id}`);
    expect(got.body.extra).toEqual(patched.body.extra);
  });

  it('неправильне значення — 400 RECORD_EXTRA_INVALID з ключем поля', async () => {
    await typeField();
    await field({ label: 'Складність', type: 'int', min: 1, max: 5 });
    for (const [extra, key] of [
      [{ nemaie: 1 }, 'nemaie'],
      [{ skladnist: 9 }, 'skladnist'],
      [{ skladnist: '3' }, 'skladnist'],
      [{ typ: 'nemaie' }, 'typ'],
    ] as const) {
      const res = await newTask(extra);
      expect([extra, res.status, res.body.errorCode, res.body.field]).toEqual([
        extra,
        400,
        'RECORD_EXTRA_INVALID',
        key,
      ]);
    }
  });

  it("обов'язкове: потрібне при створенні, не очищається; старі ТЗ не ламаються", async () => {
    const old = await newTask();
    await field({ label: 'Замовник', type: 'text', required: true });

    const missing = await newTask();
    expect(missing.body).toMatchObject({
      errorCode: 'RECORD_EXTRA_INVALID',
      field: 'zamovnyk',
    });
    const ok = await newTask({ zamovnyk: '  Кафедра  ' });
    expect(ok.body.extra).toEqual({ zamovnyk: 'Кафедра' });

    const cleared = await patchTask(ok.body.id, { zamovnyk: null });
    expect(cleared.body.field).toBe('zamovnyk');

    const rename = await as(app, mod)
      .patch(`/api/tasks/${old.body.id}`)
      .send({ title: 'Нова назва' });
    expect(rename.status).toBe(200);
  });

  it('архівний пункт довідника лишається в ТЗ, але не ставиться в нове', async () => {
    await typeField();
    const task = await newTask({ typ: 'dyzain' });
    await as(app, mod)
      .patch('/api/dictionaries/typ_tz/items/dyzain')
      .send({ archived: true });

    expect((await patchTask(task.body.id, { typ: 'dyzain' })).status).toBe(200);
    const again = await newTask({ typ: 'dyzain' });
    expect(again.body).toMatchObject({
      errorCode: 'RECORD_EXTRA_INVALID',
      field: 'typ',
    });
  });

  it('пункт у extra не видаляється; довідник поля не видаляється', async () => {
    await typeField();
    await field({ label: 'Мітки', type: 'list<enum>', dictionary: 'tehy' });
    await newTask({ typ: 'video', mitky: ['team'] });

    for (const url of [
      '/api/dictionaries/typ_tz/items/video',
      '/api/dictionaries/tehy/items/team',
    ]) {
      const res = await as(app, mod).delete(url);
      expect([url, res.body.errorCode]).toEqual([
        url,
        'DICTIONARY_ITEM_IN_USE',
      ]);
    }
    expect(
      (await as(app, mod).delete('/api/dictionaries/tehy/items/urgent')).status,
    ).toBe(200);

    const dict = await as(app, mod).get('/api/dictionaries/typ_tz');
    expect(dict.body.required).toBe(true);
    const del = await as(app, mod).delete('/api/dictionaries/typ_tz');
    expect(del.body.errorCode).toBe('DICTIONARY_IN_USE');
  });

  it('поле зі значеннями — лише в архів; без значень — видаляється', async () => {
    await typeField();
    const task = await newTask({ typ: 'video' });

    const busy = await as(app, mod).delete('/api/records/task/field-defs/typ');
    expect(busy.status).toBe(409);
    expect(busy.body.errorCode).toBe('FIELD_DEF_IN_USE');

    const archived = await as(app, mod)
      .patch('/api/records/task/field-defs/typ')
      .send({ archived: true, label: 'Тип (старий)' });
    expect(archived.body).toMatchObject({
      archived: true,
      label: 'Тип (старий)',
    });
    const schema = await as(app, member).get('/api/records/task/schema');
    expect((schema.body.fields as Field[]).at(-1)).toMatchObject({
      key: 'typ',
      archived: true,
      create: false,
    });

    // Те саме значення можна надіслати знову, нове — ні, очистити — можна.
    expect((await patchTask(task.body.id, { typ: 'video' })).status).toBe(200);
    const other = await patchTask(task.body.id, { typ: 'dyzain' });
    expect(other.body.field).toBe('typ');
    expect((await patchTask(task.body.id, { typ: null })).body.extra).toEqual(
      {},
    );

    const del = await as(app, mod).delete('/api/records/task/field-defs/typ');
    expect(del.status).toBe(200);
    const missing = await as(app, mod)
      .patch('/api/records/task/field-defs/typ')
      .send({ label: 'X' });
    expect(missing.body.errorCode).toBe('FIELD_DEF_NOT_FOUND');
    expect(await audit('record_field.updated')).toHaveLength(1);
    expect(await audit('record_field.deleted')).toHaveLength(1);
  });

  it('порядок: лише повний список ключів', async () => {
    await typeField();
    await field({ label: 'Складність', type: 'int' });
    const bad = await as(app, mod)
      .put('/api/records/task/field-defs/order')
      .send({ keys: ['typ'] });
    expect(bad.status).toBe(400);

    const res = await as(app, mod)
      .put('/api/records/task/field-defs/order')
      .send({ keys: ['skladnist', 'typ'] });
    expect(res.status).toBe(200);
    expect((res.body as FieldDef[]).map((d) => [d.key, d.position])).toEqual([
      ['skladnist', 0],
      ['typ', 1],
    ]);
    const schema = await as(app, member).get('/api/records/task/schema');
    const keys = (schema.body.fields as Field[])
      .filter((f) => f.source === 'extra')
      .map((f) => f.key);
    expect(keys).toEqual(['skladnist', 'typ']);
    expect(await audit('record_field.reordered')).toHaveLength(1);
  });
});
