import { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/users/user.entity';
import {
  createTestApp,
  makeUser,
  mfaToken,
  resetDb,
  TestUser,
} from './helpers';

// Розширена панель: лише admin, лише сесія з 2FA, лише панельний порт.
// Агент на сервері замінено фейковим на тимчасовому unix-сокеті.

type Res = { status: number; body: Record<string, any> };

function code(res: Res, status: number, errorCode: string) {
  expect(res.status).toBe(status);
  expect(res.body.errorCode).toBe(errorCode);
}

const AGENT_TOKEN = 'agent-test-token-'.padEnd(40, 'x');

/** Fake agent: records requests, one job at a time. */
function fakeAgent() {
  const seen: { method: string; url: string; auth?: string; body?: any }[] = [];
  let running: string | null = null;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({
        method: req.method!,
        url: req.url!,
        auth: req.headers.authorization,
        body,
      });
      const send = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.headers.authorization !== `Bearer ${AGENT_TOKEN}`)
        return send(401, {});
      const url = req.url!;
      if (url === '/v1/metrics')
        return send(200, { cpuPercent: 12.5, uptimeSeconds: 3600 });
      if (url === '/v1/containers')
        return send(200, { items: [{ name: 'api', state: 'running' }] });
      if (url === '/v1/last-backup')
        return send(200, { found: true, file: 'db-1.dump' });
      if (url.startsWith('/v1/logs')) return send(200, { lines: ['a', 'b'] });
      if (url === '/v1/jobs' && req.method === 'POST') {
        if (running) return send(409, { error: 'busy' });
        running = 'a'.repeat(32);
        return send(202, {
          id: running,
          action: body.action,
          status: 'running',
          output: [],
        });
      }
      if (url.startsWith('/v1/jobs/'))
        return send(200, {
          id: url.slice(9),
          status: 'succeeded',
          exitCode: 0,
          output: ['ok'],
        });
      send(404, {});
    });
  });
  return { server, seen, finish: () => (running = null) };
}

describe('Розширена панель (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let panel: string;
  let mainServer: Server;
  let main: string;
  let dir: string;
  let agent: ReturnType<typeof fakeAgent>;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;
  let adminMfa: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-agent-'));
    process.env.AGENT_SOCKET = join(dir, 'agent.sock');
    process.env.AGENT_TOKEN = AGENT_TOKEN;
    agent = fakeAgent();
    await new Promise<void>((r) =>
      agent.server.listen(process.env.AGENT_SOCKET, r),
    );

    app = await createTestApp();
    ds = app.get(DataSource);
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    process.env.PANEL_PORT = String(port);
    panel = `http://127.0.0.1:${port}`;
    // "Funnel" port: the same app on another port.
    mainServer = createServer(app.getHttpAdapter().getInstance());
    await new Promise<void>((r) => mainServer.listen(0, '127.0.0.1', r));
    main = `http://127.0.0.1:${(mainServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env = saved;
    await new Promise((r) => mainServer.close(r));
    await new Promise((r) => agent.server.close(r));
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDb(app);
    agent.seen.length = 0;
    agent.finish();
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
    adminMfa = await mfaToken(app, admin);
  });

  const get = (base: string, path: string, token: string) =>
    request(base).get(path).set('Authorization', `Bearer ${token}`);
  const post = (base: string, path: string, token: string, body: object = {}) =>
    request(base).post(path).set('Authorization', `Bearer ${token}`).send(body);

  describe('матриця прав: розширена панель', () => {
    it('admin з 2FA так', async () => {
      const r = await get(panel, '/admin-panel/overview', adminMfa);
      expect(r.status).toBe(200);
    });
    it('admin без 2FA ні', async () => {
      code(
        await get(panel, '/admin-panel/overview', admin.token),
        403,
        'TWO_FACTOR_REQUIRED',
      );
    });
    it('moderator і member ні', async () => {
      code(
        await get(panel, '/admin-panel/overview', mod.token),
        403,
        'FORBIDDEN',
      );
      code(
        await get(panel, '/admin-panel/overview', member.token),
        403,
        'FORBIDDEN',
      );
      const modMfa = await mfaToken(app, mod);
      code(await get(panel, '/admin-panel/overview', modMfa), 403, 'FORBIDDEN');
    });
    it('2FA вимкнули — сесія з 2FA більше не підходить', async () => {
      await ds.query(`UPDATE users SET totp_enabled_at = NULL WHERE id = $1`, [
        admin.id,
      ]);
      code(
        await get(panel, '/admin-panel/overview', adminMfa),
        403,
        'TWO_FACTOR_REQUIRED',
      );
    });
  });

  it('на основному порту (Funnel) панелі немає: 404', async () => {
    code(await get(main, '/admin-panel/overview', adminMfa), 404, 'NOT_FOUND');
    code(
      await post(main, '/admin-panel/actions/backup', adminMfa),
      404,
      'NOT_FOUND',
    );
    // Решта API на основному порту працює.
    expect((await get(main, '/auth/me', admin.token)).status).toBe(200);
  });

  it('огляд: метрики, контейнери, бекап; агенту йде токен', async () => {
    const r = await get(panel, '/admin-panel/overview', adminMfa);
    expect(r.body).toEqual({
      metrics: { cpuPercent: 12.5, uptimeSeconds: 3600 },
      containers: [{ name: 'api', state: 'running' }],
      lastBackup: { found: true, file: 'db-1.dump' },
    });
    expect(agent.seen.every((s) => s.auth === `Bearer ${AGENT_TOKEN}`)).toBe(
      true,
    );
  });

  it('логи: кількість рядків обмежена', async () => {
    const r = await get(panel, '/admin-panel/logs?lines=999', adminMfa);
    expect(r.body.lines).toEqual(['a', 'b']);
    expect(agent.seen.at(-1)!.url).toBe('/v1/logs?lines=500');
    code(
      await get(panel, '/admin-panel/logs?lines=-5', adminMfa),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('дії: бекап, одна за раз, статус задачі, аудит', async () => {
    const r = await post(panel, '/admin-panel/actions/backup', adminMfa);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ action: 'backup', status: 'running' });
    expect(agent.seen.at(-1)!.body).toEqual({ action: 'backup' });
    code(
      await post(panel, '/admin-panel/actions/restore-check', adminMfa),
      409,
      'AGENT_BUSY',
    );

    const job = await get(panel, `/admin-panel/jobs/${r.body.id}`, adminMfa);
    expect(job.body).toMatchObject({ status: 'succeeded', exitCode: 0 });
    code(
      await get(panel, '/admin-panel/jobs/..%2F..%2Fetc', adminMfa),
      400,
      'VALIDATION_ERROR',
    );

    const [log] = await ds.query<
      { actor_id: string; meta: { action: string } }[]
    >(`SELECT actor_id, meta FROM audit_log WHERE action = 'panel.action'`);
    expect(log).toMatchObject({
      actor_id: admin.id,
      meta: { action: 'backup' },
    });
  });

  it('перезапуск: лише api або ha', async () => {
    const r = await post(panel, '/admin-panel/actions/restart', adminMfa, {
      target: 'ha',
    });
    expect(r.status).toBe(202);
    expect(agent.seen.at(-1)!.body).toEqual({ action: 'restart-ha' });
    agent.finish();
    for (const target of ['db', 'all', '']) {
      code(
        await post(panel, '/admin-panel/actions/restart', adminMfa, { target }),
        400,
        'VALIDATION_ERROR',
      );
    }
  });

  it('агент недоступний: 503, решта API працює', async () => {
    process.env.AGENT_SOCKET = join(dir, 'missing.sock');
    try {
      code(
        await get(panel, '/admin-panel/overview', adminMfa),
        503,
        'AGENT_UNAVAILABLE',
      );
      expect((await get(panel, '/auth/me', admin.token)).status).toBe(200);
    } finally {
      process.env.AGENT_SOCKET = join(dir, 'agent.sock');
    }
  });

  it('неправильний токен агента: 503 без подробиць', async () => {
    process.env.AGENT_TOKEN = 'wrong';
    try {
      code(
        await get(panel, '/admin-panel/overview', adminMfa),
        503,
        'AGENT_UNAVAILABLE',
      );
    } finally {
      process.env.AGENT_TOKEN = AGENT_TOKEN;
    }
  });
});
