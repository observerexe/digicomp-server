import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { RECORD_TYPES } from '../src/records/field-types';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

type Field = { key: string; type: string; create?: boolean; options?: unknown };

describe('Схеми записів (e2e)', () => {
  let app: INestApplication<App>;
  let member: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    member = await makeUser(app, Role.Member);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(RECORD_TYPES.map((t) => [t]))('%s: схема з версією', async (type) => {
    const res = await as(app, member).get(`/api/records/${type}/schema`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type, version: expect.any(String) });
    expect(res.body.fields.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('entity');
    expect(res.body).not.toHaveProperty('dto');
  });

  it('ТЗ: поля з DTO, статус лише для читання', async () => {
    const res = await as(app, member).get('/api/records/task/schema');
    const fields = res.body.fields as Field[];
    const field = (key: string) => fields.find((f) => f.key === key);
    expect(field('title')).toMatchObject({
      type: 'text',
      required: true,
      maxLength: 200,
    });
    expect(field('status')).toMatchObject({ type: 'enum' });
    expect(field('status')?.create).toBeUndefined();
    expect(field('assignees')).toMatchObject({
      type: 'list<ref:user>',
      source: 'relation',
    });
  });

  it('учасник: секретів у схемі немає', async () => {
    const res = await as(app, member).get('/api/records/user/schema');
    const keys = (res.body.fields as Field[]).map((f) => f.key);
    expect(keys).toContain('name');
    for (const secret of ['password', 'passwordHash', 'totpSecretEnc']) {
      expect(keys).not.toContain(secret);
    }
  });

  it('невідомий тип — 404 RECORD_TYPE_NOT_FOUND', async () => {
    const res = await as(app, member).get('/api/records/paper/schema');
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('RECORD_TYPE_NOT_FOUND');
  });

  it('без входу — 401', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/records/task/schema',
    );
    expect(res.status).toBe(401);
  });
});
