import { INestApplication } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers';

// Фронт роздає той самий NestJS: сторінки застосунку на будь-якій адресі
// поза /api і /health, API — лише під /api. CSP і заголовки — ті самі.

describe('Роздача вебзастосунку (e2e)', () => {
  let app: INestApplication<App>;
  let dir: string;
  const saved = process.env.WEB_DIST;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><title>DigiComp HUB</title><div id="root"></div>',
    );
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(dir, 'sw.js'), 'self.x=1');
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    process.env.WEB_DIST = dir;
    app = await createTestApp();
  });

  afterAll(async () => {
    process.env.WEB_DIST = saved;
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('/ і будь-яка сторінка застосунку віддають index.html з CSP', async () => {
    for (const path of ['/', '/tasks', '/lab/CNC-1', '/login?next=%2Ftasks']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('<div id="root">');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toContain(
        "script-src 'self'",
      );
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('файли з хешем кешуються назавжди, service worker — ні', async () => {
    const js = await get('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect((await get('/sw.js')).headers['cache-control']).toBe('no-cache');
  });

  it('API лише під /api: без входу 401 JSON, невідомий шлях 404 JSON', async () => {
    const tasks = await get('/api/tasks');
    expect(tasks.status).toBe(401);
    expect(tasks.headers['content-type']).toContain('application/json');
    const nope = await get('/api/no-such-thing');
    expect(nope.status).toBe(404);
    expect(nope.body.errorCode).toBe('NOT_FOUND');
    expect(nope.headers['cache-control']).toBe('no-store');
  });

  it('/health лишається в корені', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('прихованих файлів не віддає', async () => {
    const res = await get('/.env');
    expect(res.text).not.toContain('SECRET');
  });

  it('POST поза /api — не сторінка, а 404 JSON', async () => {
    const res = await request(app.getHttpServer()).post('/tasks').send({});
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
