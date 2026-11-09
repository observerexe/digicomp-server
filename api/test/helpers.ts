import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';
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

/** Requests with a Bearer token (no cookies, so no CSRF header needed). */
export function as(app: INestApplication<App>, user: { token: string }) {
  const server = app.getHttpServer();
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${user.token}`);
  return {
    get: (url: string) => auth(request(server).get(url)),
    post: (url: string) => auth(request(server).post(url)),
    patch: (url: string) => auth(request(server).patch(url)),
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
