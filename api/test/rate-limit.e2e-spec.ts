import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/users/user.entity';
import { createTestApp, makeUser, resetDb } from './helpers';

// Ліміти запитів на вхід рахуються за email, а не за IP: так один
// зловмисник не заблокує вхід усій групі за одним NAT, і навпаки.
// Тест стежить, щоб правило не загубилося під префіксом /api.

describe('Ліміти входу (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('10 спроб на email за хвилину; інший email не блокується', async () => {
    await resetDb(app);
    const a = await makeUser(app, Role.Member);
    const b = await makeUser(app, Role.Member);
    const login = (email: string) =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'wrong-password' });
    for (let i = 0; i < 10; i++) {
      expect((await login(a.email)).status).toBe(401);
    }
    const blocked = await login(a.email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.errorCode).toBe('RATE_LIMITED');
    // Той самий IP, інший email — не заблоковано.
    expect((await login(b.email)).status).toBe(401);
  });
});
