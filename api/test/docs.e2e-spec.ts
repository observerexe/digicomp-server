import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

describe('OpenAPI і /docs (лише admin)', () => {
  let app: INestApplication<App>;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDb(app);
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
  });

  afterAll(async () => {
    await app.close();
  });

  it('без входу 401', async () => {
    await request(app.getHttpServer()).get('/docs').expect(401);
    await request(app.getHttpServer()).get('/docs/openapi.json').expect(401);
  });

  it('moderator і member: 403', async () => {
    for (const u of [mod, member]) {
      const res = await as(app, u).get('/docs');
      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('FORBIDDEN');
      expect((await as(app, u).get('/docs/openapi.json')).status).toBe(403);
    }
  });

  it('admin бачить сторінку; CSP послаблено лише для стилів', async () => {
    const res = await as(app, admin).get('/docs').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('/docs/assets/init.js');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('CSP решти API не змінено', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['content-security-policy']).toContain(
      "style-src 'self';",
    );
  });

  it('admin отримує OpenAPI зі шляхами API, без /docs', async () => {
    const res = await as(app, admin).get('/docs/openapi.json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths['/users/{id}']).toBeDefined();
    expect(res.body.paths['/smart/allowlist']).toBeDefined();
    expect(Object.keys(res.body.paths).some((p) => p.startsWith('/docs'))).toBe(
      false,
    );
  });

  it('файли Swagger UI: лише зі списку', async () => {
    const js = await as(app, admin).get('/docs/assets/init.js').expect(200);
    expect(js.headers['content-type']).toContain('javascript');
    await as(app, admin).get('/docs/assets/swagger-ui.css').expect(200);
    await as(app, admin).get('/docs/assets/package.json').expect(404);
    await as(app, admin).get('/docs/assets/..%2F..%2Fpackage.json').expect(404);
  });
});
