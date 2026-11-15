import { HttpException, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, type EntityManager } from 'typeorm';
import { AppModule } from '../src/app.module';
import { codeFor } from '../src/common/http-exception.filter';
import { DisciplineService } from '../src/discipline/discipline.service';
import type { IssueDisciplineDto } from '../src/discipline/dto';
import {
  DISCIPLINE_TEMPLATES,
  DisciplineTemplates1813000000000,
} from '../src/migrations/1813000000000-DisciplineTemplates';
import {
  TASK_TEMPLATES,
  TaskTemplates1812000000000,
} from '../src/migrations/1812000000000-TaskTemplates';
import {
  POINTS_TEMPLATES,
  PointsTemplates1815000000000,
} from '../src/migrations/1815000000000-PointsTemplates';
import { PointsEntry, PointsKind } from '../src/points/points-entry.entity';
import { slugify } from '../src/dictionaries/keys';
import { setupApp } from '../src/setup-app';
import type { CreateTaskDto } from '../src/tasks/dto';
import { TasksService } from '../src/tasks/tasks.service';
import { Role, User } from '../src/users/user.entity';

export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  setupApp(app);
  await app.init();
  return app;
}

/** Empties every table except the migrations log. */
export async function resetDb(app: INestApplication) {
  const ds = app.get(DataSource);
  const rows = await ds.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (!rows.length) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await ds.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const PASSWORD = 'test-password-123';
let hash: string | undefined;

export type TestUser = User & { token: string };

export async function makeUser(
  app: INestApplication,
  role: Role,
  over: Partial<User> = {},
): Promise<TestUser> {
  hash ??= await argon2.hash(PASSWORD);
  const repo = app.get(DataSource).getRepository(User);
  const n = Math.random().toString(36).slice(2, 10);
  const u = await repo.save(
    repo.create({
      email: `${role}-${n}@test.local`,
      name: `${role} ${n}`,
      passwordHash: hash,
      role,
      bio: 'біо',
      ...over,
    }),
  );
  const token = await app
    .get(JwtService)
    .signAsync({ sub: u.id, role: u.role });
  return Object.assign(u, { token });
}

/**
 * A task made by `by` as publishing its document would make it (no
 * document): for tests about anything but making tasks. Making and
 * changing tasks through documents — paper-publish, paper-change.
 */
export async function makeTask(
  app: INestApplication,
  by: User,
  over: Partial<CreateTaskDto> = {},
) {
  return app
    .get(DataSource)
    .transaction((m) =>
      app.get(TasksService).create({ title: 'ТЗ', points: 10, ...over }, by, m),
    );
}

/**
 * Runs the tasks service in a transaction, as a document's adapter does,
 * and answers as the API would: `{ status, body }`, errors with errorCode.
 */
export function withTasks(
  app: INestApplication,
  run: (tasks: TasksService, m: EntityManager) => Promise<unknown>,
) {
  return answered(app, (m) => run(app.get(TasksService), m));
}

/** The discipline service in a transaction, as a document's adapter runs it (see withTasks). */
export function withDiscipline(
  app: INestApplication,
  run: (discipline: DisciplineService, m: EntityManager) => Promise<unknown>,
) {
  return answered(app, (m) => run(app.get(DisciplineService), m));
}

/**
 * A discipline record issued by `by` as publishing its document would issue
 * it, but without the document — as records made before documents are:
 * `{ status, body }` (body — the record). Issuing through documents —
 * discipline-papers.e2e-spec.ts.
 */
export function issueRecord(
  app: INestApplication,
  by: User,
  dto: Record<string, unknown>,
) {
  return withDiscipline(app, (d, m) =>
    d.issue(dto as unknown as IssueDisciplineDto, by, m),
  );
}

async function answered(
  app: INestApplication,
  run: (m: EntityManager) => Promise<unknown>,
): Promise<{ status: number; body: Record<string, any> }> {
  try {
    const body = await app.get(DataSource).transaction(run);
    return { status: 200, body: body as Record<string, any> };
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    const raw = e.getResponse();
    const body: Record<string, any> =
      typeof raw === 'string' ? { message: raw } : { ...raw };
    body.errorCode ??= codeFor(e.getStatus(), body.message);
    return { status: e.getStatus(), body };
  }
}

/**
 * «Подання про стягнення» and «Пояснювальна записка» as the migration makes
 * them (it needs an active admin).
 */
export async function disciplineTemplates(app: INestApplication) {
  const q = app.get(DataSource).createQueryRunner();
  try {
    await new DisciplineTemplates1813000000000().up(q);
  } finally {
    await q.release();
  }
  const [issue, note] = DISCIPLINE_TEMPLATES.map((t) => t.id);
  return { issue, note };
}

/**
 * «Технічне завдання» and «Коротке ТЗ» as the migration makes them (it
 * needs an active admin; on an empty database at start it makes nothing).
 */
export async function taskTemplates(app: INestApplication) {
  const q = app.get(DataSource).createQueryRunner();
  try {
    await new TaskTemplates1812000000000().up(q);
  } finally {
    await q.release();
  }
  const [full, short] = TASK_TEMPLATES.map((t) => t.id);
  return { full, short };
}

/**
 * A task made through a document of «Коротке ТЗ» (see taskTemplates): the
 * document is made, filled and published by `by`; the response of publish.
 */
export async function publishTaskPaper(
  app: INestApplication<App>,
  by: { token: string },
  templateId: string,
  values: Record<string, unknown> = { title: 'ТЗ', points: 10 },
) {
  const p = await as(app, by).post('/api/papers').send({ templateId });
  if (p.status !== 201) return p;
  const saved = await as(app, by)
    .patch(`/api/papers/${p.body.id}`)
    .send({ revision: p.body.revision, values });
  if (saved.status !== 200) return saved;
  return as(app, by).post(`/api/papers/${p.body.id}/publish`);
}

/** «Відомість балів» as the migration makes it (it needs an active admin). */
export async function pointsTemplates(app: INestApplication) {
  const q = app.get(DataSource).createQueryRunner();
  try {
    await new PointsTemplates1815000000000().up(q);
  } finally {
    await q.release();
  }
  return POINTS_TEMPLATES[0]!.id;
}

/** A row of «Відомість балів»: who, how many points, what for. */
export type AwardRow = { member?: string; amount?: number; reason?: string };

/**
 * Points awarded through «Відомість балів» (see pointsTemplates): the
 * document is made, filled with the rows and published by `by`; the
 * response of the first request that failed, or of publish.
 */
export async function publishSheet(
  app: INestApplication<App>,
  by: { token: string },
  templateId: string,
  rows: AwardRow[],
) {
  const p = await as(app, by).post('/api/papers').send({ templateId });
  if (p.status !== 201) return p;
  const saved = await as(app, by)
    .patch(`/api/papers/${p.body.id}`)
    .send({ revision: p.body.revision, values: { awards: rows } });
  if (saved.status !== 200) return saved;
  return as(app, by).post(`/api/papers/${p.body.id}/publish`);
}

/**
 * A manual award made before documents (no «Відомість балів» refers to it):
 * written straight to the ledger, as the old `POST /points/award` wrote it.
 */
export function oldAward(
  app: INestApplication,
  by: { id: string },
  to: { id: string },
  amount: number,
  reason = 'чергування',
) {
  const repo = app.get(DataSource).getRepository(PointsEntry);
  return repo.save(
    repo.create({
      userId: to.id,
      amount,
      reason,
      kind: PointsKind.Manual,
      createdById: by.id,
    }),
  );
}

/** Requests with a Bearer token (no cookies, so no CSRF header needed). */
export function as(app: INestApplication<App>, user: { token: string }) {
  const server = app.getHttpServer();
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${user.token}`);
  return {
    get: (url: string) => auth(request(server).get(url)),
    post: (url: string) => auth(request(server).post(url)),
    patch: (url: string) => auth(request(server).patch(url)),
    put: (url: string) => auth(request(server).put(url)),
    delete: (url: string) => auth(request(server).delete(url)),
  };
}

/** Smallest valid PNG (1x1), passes the magic-bytes check. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Access token of a session that passed 2FA (2FA marked as enabled in the
 * database). The full 2FA flow is covered by two-factor.e2e-spec.ts.
 */
export async function mfaToken(app: INestApplication, user: TestUser) {
  await app
    .get(DataSource)
    .query(`UPDATE users SET totp_enabled_at = now() WHERE id = $1`, [user.id]);
  return app
    .get(JwtService)
    .signAsync({ sub: user.id, role: user.role, mfa: true });
}

const CATEGORY_DICTIONARIES = {
  place_category: 'Категорія обладнання',
  document_category: 'Категорія архіву',
  inventory_category: 'Категорія складу',
};

/**
 * Key of a category item, created if missing. The migration makes the
 * category dictionaries, but resetDb empties them.
 */
export async function category(
  app: INestApplication,
  dictionaryKey: keyof typeof CATEGORY_DICTIONARIES,
  title: string,
): Promise<string> {
  const ds = app.get(DataSource);
  await ds.query(
    `INSERT INTO dictionaries (key, title) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [dictionaryKey, CATEGORY_DICTIONARIES[dictionaryKey]],
  );
  const [{ id }] = await ds.query<{ id: string }[]>(
    `SELECT id FROM dictionaries WHERE key = $1`,
    [dictionaryKey],
  );
  const key = slugify(title);
  await ds.query(
    `INSERT INTO dictionary_items (dictionary_id, key, title, position)
     VALUES ($1, $2, $3, (SELECT count(*) FROM dictionary_items WHERE dictionary_id = $1))
     ON CONFLICT (dictionary_id, key) DO NOTHING`,
    [id, key, title],
  );
  return key;
}
