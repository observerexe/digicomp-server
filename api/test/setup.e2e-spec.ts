import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { STARTER_TEMPLATES } from '../src/migrations/1809000000000-StarterTemplates';
import { TASK_TEMPLATES } from '../src/migrations/1812000000000-TaskTemplates';
import { DISCIPLINE_TEMPLATES } from '../src/migrations/1813000000000-DisciplineTemplates';
import { POINTS_TEMPLATES } from '../src/migrations/1815000000000-PointsTemplates';
import { REPORT_TEMPLATES } from '../src/migrations/1819000000000-ReportTemplates';
import { AUTHORIZATION_TEMPLATES } from '../src/migrations/1821000000000-AuthorizationTemplates';
import { PROJECT_INVENTORY_TEMPLATES } from '../src/migrations/1823000000000-ProjectInventoryTemplates';
import { seedTemplates } from '../src/paperwork/seed-templates';
import { createTestApp, resetDb } from './helpers';

const ALL = [
  ...STARTER_TEMPLATES,
  ...TASK_TEMPLATES,
  ...DISCIPLINE_TEMPLATES,
  ...POINTS_TEMPLATES,
  ...REPORT_TEMPLATES,
  ...AUTHORIZATION_TEMPLATES,
  ...PROJECT_INVENTORY_TEMPLATES,
];

/** A new installation: migrations ran on an empty database, then the first admin. */
describe('POST /api/auth/setup (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
  });

  beforeEach(() => resetDb(app));

  afterAll(async () => {
    await app.close();
  });

  const templates = () =>
    ds.query<{ id: string; created_by_id: string; current_version_id: string | null }[]>(
      `SELECT "id", "created_by_id", "current_version_id" FROM "paper_templates" ORDER BY "id"`,
    );

  it('перший адмін отримує всі початкові шаблони, опубліковані від його імені', async () => {
    expect(await templates()).toEqual([]);
    const res = await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ email: 'first@example.com', name: 'Перший', password: 'first-password' })
      .expect(201);
    const rows = await templates();
    expect(rows.map((r) => r.id).sort()).toEqual(ALL.map((t) => t.id).sort());
    for (const r of rows) {
      expect(r.created_by_id).toBe(res.body.id);
      expect(r.current_version_id).not.toBeNull();
    }
  });

  it('повторний запуск нічого не змінює, другий setup — 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ email: 'first@example.com', name: 'Перший', password: 'first-password' })
      .expect(201);
    const before = await templates();
    const q = ds.createQueryRunner();
    try {
      await seedTemplates(q);
    } finally {
      await q.release();
    }
    expect(await templates()).toEqual(before);
    await request(app.getHttpServer())
      .post('/api/auth/setup')
      .send({ email: 'second@example.com', name: 'Другий', password: 'second-password' })
      .expect(409);
  });
});
