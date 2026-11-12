import { INestApplication } from '@nestjs/common';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { App } from 'supertest/types';
import { Role } from '../src/users/user.entity';
import { as, createTestApp, makeUser, resetDb, TestUser } from './helpers';

type HaState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
};

/** A tiny Home Assistant: /api/config, /api/states, /api/services. */
function fakeHa() {
  let states: HaState[] = [];
  const calls: { path: string; body: unknown }[] = [];
  const reset = (next: HaState[]) => {
    states = next;
    calls.length = 0;
  };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== 'Bearer ha-test-token')
        return send(401, {});
      const url = req.url ?? '';
      if (url === '/api/config')
        return send(200, { version: '2026.11.0', location_name: 'Лаб' });
      if (url === '/api/states') return send(200, states);
      const one = /^\/api\/states\/(.+)$/.exec(url);
      if (one) {
        const s = states.find(
          (x) => x.entity_id === decodeURIComponent(one[1]),
        );
        return s ? send(200, s) : send(404, {});
      }
      if (req.method === 'POST' && url.startsWith('/api/services/')) {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        calls.push({ path: url, body });
        const s = states.find((x) => x.entity_id === body.entity_id);
        if (s && url === '/api/services/light/turn_on') {
          s.state = 'on';
          if (typeof body.brightness_pct === 'number')
            s.attributes.brightness = Math.round(
              (body.brightness_pct / 100) * 255,
            );
        }
        if (s && url === '/api/services/light/turn_off') {
          s.state = 'off';
          s.attributes.brightness = null;
        }
        return send(200, []);
      }
      send(404, {});
    });
  });
  return { server, calls, reset };
}

describe('Розумна лабораторія (e2e, фейковий HA)', () => {
  let app: INestApplication<App>;
  let ha: ReturnType<typeof fakeHa>;
  let admin: TestUser;
  let mod: TestUser;
  let member: TestUser;

  const states = (): HaState[] => [
    {
      entity_id: 'light.workshop',
      state: 'off',
      attributes: { friendly_name: 'Майстерня', brightness: null },
    },
    {
      entity_id: 'sensor.temp',
      state: '21.5',
      attributes: {
        friendly_name: 'Температура',
        unit_of_measurement: '°C',
        device_class: 'temperature',
      },
    },
    {
      entity_id: 'binary_sensor.leak',
      state: 'off',
      attributes: { friendly_name: 'Протікання', device_class: 'moisture' },
    },
    {
      entity_id: 'switch.soldering_iron',
      state: 'off',
      attributes: { friendly_name: 'Паяльник' },
    },
  ];

  beforeAll(async () => {
    ha = fakeHa();
    await new Promise<void>((r) => ha.server.listen(0, '127.0.0.1', r));
    const { port } = ha.server.address() as AddressInfo;
    process.env.HA_URL = `http://127.0.0.1:${port}`;
    process.env.HA_TOKEN = 'ha-test-token';
    app = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.HA_TOKEN;
    delete process.env.HA_URL;
    await app.close();
    await new Promise((r) => ha.server.close(r));
  });

  beforeEach(async () => {
    await resetDb(app);
    ha.reset(states());
    admin = await makeUser(app, Role.Admin);
    mod = await makeUser(app, Role.Moderator);
    member = await makeUser(app, Role.Member);
  });

  const add = (entityId: string, kind: string, label: string, room = 'Лаб') =>
    as(app, admin)
      .post('/api/smart/allowlist')
      .send({ entityId, kind, label, room });

  it('пошук у HA: світло, датчики й датчики «так/ні», без вимикачів', async () => {
    const res = await as(app, admin).get('/api/smart/discover');
    expect(res.status).toBe(200);
    const ids = (res.body as { items: { entityId: string; kind: string }[] })
      .items;
    expect(ids.map((i) => i.entityId).sort()).toEqual([
      'binary_sensor.leak',
      'light.workshop',
      'sensor.temp',
    ]);
    expect(ids.find((i) => i.entityId === 'binary_sensor.leak')?.kind).toBe(
      'binary_sensor',
    );
  });

  it('датчик «так/ні» додається і показується лише для перегляду', async () => {
    expect(
      (await add('binary_sensor.leak', 'binary_sensor', 'Протікання')).status,
    ).toBe(201);
    const list = await as(app, member).get('/api/smart/entities');
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({
      kind: 'binary_sensor',
      label: 'Протікання',
      available: true,
      value: 'off',
      deviceClass: 'moisture',
    });
    const id = list.body.items[0].id as string;
    // Not a light: the light endpoint does not know it.
    const ctl = await as(app, admin)
      .post(`/api/smart/lights/${id}/state`)
      .send({ on: true });
    expect(ctl.status).toBe(404);
    expect(ctl.body.errorCode).toBe('SMART_DEVICE_NOT_FOUND');
  });

  it('вимикач додати неможливо', async () => {
    const res = await add('switch.soldering_iron', 'light', 'Паяльник');
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('світло: модератор вмикає з яскравістю, учасник — ні; дія в аудиті', async () => {
    const created = await add('light.workshop', 'light', 'Майстерня');
    const id = created.body.id as string;
    const on = await as(app, mod)
      .post(`/api/smart/lights/${id}/state`)
      .send({ on: true, brightness: 40 });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ on: true, brightness: 40 });
    expect(ha.calls).toContainEqual({
      path: '/api/services/light/turn_on',
      body: { entity_id: 'light.workshop', brightness_pct: 40 },
    });
    const denied = await as(app, member)
      .post(`/api/smart/lights/${id}/state`)
      .send({ on: false });
    expect(denied.status).toBe(403);
    const audit = await as(app, admin).get('/api/audit?action=smart.light_set');
    expect(audit.body).toHaveLength(1);
  });

  it('стан зв’язку й список дозволених для адміна', async () => {
    await add('sensor.temp', 'sensor', 'Температура', 'Офіс');
    const status = await as(app, admin).get('/api/smart/status');
    expect(status.body).toEqual({
      connected: true,
      version: '2026.11.0',
      name: 'Лаб',
      allowedEntities: 1,
    });
    const list = await as(app, admin).get('/api/smart/allowlist');
    expect(list.body.items[0]).toMatchObject({
      entityId: 'sensor.temp',
      kind: 'sensor',
      room: 'Офіс',
      enabled: true,
    });
  });
});
