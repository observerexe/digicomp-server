import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health: API і база працюють', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('GET /: старого вебінтерфейсу більше немає', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  it('усі відповіді мають заголовки безпеки', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('cookie-запит без X-DC-Client відхиляється з кодом CSRF', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', 'dc_rt=fake')
      .expect(403);
    expect(res.body).toMatchObject({ errorCode: 'CSRF' });
  });

  it('cookie-запит із чужим Origin відхиляється з кодом CSRF', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', 'dc_rt=fake')
      .set('X-DC-Client', 'web')
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(res.body).toMatchObject({ errorCode: 'CSRF' });
  });
});
