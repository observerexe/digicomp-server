import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Me } from '../../api/types';
import { json, member as baseMember, mockApi, moderator as baseMod, renderApp } from '../../test/render';
import { binaryAlarm, binaryText, byRoom, NO_ROOM, sensorText, type SmartState } from './logic';
import { SMART_TIMING } from './SmartPage';

const member: Me = { ...baseMember, permissions: [...baseMember.permissions, 'smart.read'] };
const moderator: Me = { ...baseMod, permissions: [...baseMod.permissions, 'smart.read', 'smart.control'] };
const admin: Me = { ...moderator, id: 'a1', name: 'Ірина Адмін', role: 'admin', permissions: [...moderator.permissions, 'smart.allowlist'] };

const base = { enabled: true, available: true };
const entities = (): SmartState[] => [
  { ...base, id: 'l1', kind: 'light', label: 'Стеля', room: 'Майстерня', on: false, brightness: null },
  { ...base, id: 'l2', kind: 'light', label: 'Стіл', room: 'Майстерня', on: true, brightness: 80 },
  { ...base, id: 'sc', kind: 'scene', label: 'Вечір', room: 'Майстерня' },
  { ...base, id: 't1', kind: 'sensor', label: 'Температура', room: 'Офіс', value: '21.46', unit: '°C', deviceClass: 'temperature' },
  { ...base, id: 'w1', kind: 'binary_sensor', label: 'Підлога', room: 'Офіс', value: 'on', deviceClass: 'moisture' },
  { ...base, id: 'x1', kind: 'light', label: 'Вулиця', room: '', available: false },
];

type H = Record<string, (req: Request) => Response | Promise<Response>>;
const smartApi = (me: Me, extra: H = {}): H => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/smart/entities': () => json(200, { items: entities() }),
  ...extra,
});

beforeEach(() => {
  SMART_TIMING.refreshMs = 60_000;
  SMART_TIMING.brightnessDelayMs = 5;
});

describe('Розумна лабораторія', () => {
  it('учасник: кімнати, значення датчиків, без керування', async () => {
    mockApi(smartApi(member));
    renderApp('/smart');
    const workshop = await screen.findByRole('region', { name: 'Майстерня' });
    expect(within(workshop).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Стеля', 'Стіл', 'Вечір']);
    expect(within(workshop).getByText('Увімкнено · 80%')).toBeInTheDocument();
    const office = screen.getByRole('region', { name: 'Офіс' });
    expect(within(office).getByText('21,5 °C')).toBeInTheDocument();
    expect(within(office).getByText('Протікання!')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: NO_ROOM })).getByText('недоступний')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Увімкнути' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Пристрої' })).not.toBeInTheDocument();
    expect(screen.getByText(/Керують світлом і сценами модератори/)).toBeInTheDocument();
  });

  it('модератор вмикає світло: одразу на екрані, запит з on=true', async () => {
    const { calls } = mockApi(
      smartApi(moderator, {
        'POST /api/smart/lights/l1/state': () => json(200, { ...entities()[0], on: true, brightness: 100 }),
      }),
    );
    renderApp('/smart');
    const sw = await screen.findByRole('switch', { name: 'Стеля' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await screen.findByText('Увімкнено · 100%');
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ on: true });
    // An unavailable lamp has no switch.
    expect(screen.queryByRole('switch', { name: 'Вулиця' })).not.toBeInTheDocument();
  });

  it('помилка: перемикач повертається, текст за кодом', async () => {
    mockApi(smartApi(moderator, { 'POST /api/smart/lights/l1/state': () => json(409, { errorCode: 'DEVICE_UNAVAILABLE' }) }));
    renderApp('/smart');
    const sw = await screen.findByRole('switch', { name: 'Стеля' });
    await userEvent.click(sw);
    expect(await screen.findByText(/Пристрій зараз недоступний/)).toBeInTheDocument();
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('яскравість: один запит, коли повзунок зупинився', async () => {
    const { calls } = mockApi(
      smartApi(moderator, {
        'POST /api/smart/lights/l2/state': async (req) => {
          const body = (await req.json()) as { brightness: number };
          return json(200, { ...entities()[1], brightness: body.brightness });
        },
      }),
    );
    renderApp('/smart');
    const slider = await screen.findByRole('slider', { name: 'Яскравість, Стіл' });
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.change(slider, { target: { value: '45' } });
    fireEvent.change(slider, { target: { value: '60' } });
    await screen.findByText('Увімкнено · 60%');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body)).toEqual({ on: true, brightness: 60 });
  });

  it('сцена вмикається кнопкою', async () => {
    const { calls } = mockApi(smartApi(moderator, { 'POST /api/smart/scenes/sc/activate': () => json(200, { ok: true }) }));
    renderApp('/smart');
    const scene = await screen.findByRole('article', { name: 'Вечір' });
    await userEvent.click(within(scene).getByRole('button', { name: 'Увімкнути' }));
    expect(await within(scene).findByText('Увімкнено')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/smart/scenes/sc/activate')).toBe(true);
  });

  it('HA не налаштований — людський текст', async () => {
    mockApi(smartApi(member, { 'GET /api/smart/entities': () => json(503, { errorCode: 'SMART_NOT_CONFIGURED' }) }));
    renderApp('/smart');
    expect(await screen.findByText('Розумна лабораторія ще не налаштована.')).toBeInTheDocument();
  });

  it('порожньо: адміну — посилання на пристрої', async () => {
    mockApi(smartApi(admin, { 'GET /api/smart/entities': () => json(200, { items: [] }) }));
    renderApp('/smart');
    expect(await screen.findByRole('link', { name: /Додайте їх зі списку/ })).toHaveAttribute('href', '/smart/devices');
  });
});

describe('Пристрої (адмін)', () => {
  const allowed = [{ id: 'l1', entityId: 'light.ceiling', kind: 'light', label: 'Стеля', room: 'Майстерня', enabled: true }];
  const devicesApi = (me: Me, extra: H = {}): H => ({
    ...smartApi(me),
    'GET /api/smart/status': () => json(200, { connected: true, version: '2026.11.0', name: 'Лаб', allowedEntities: 1 }),
    'GET /api/smart/allowlist': () => json(200, { items: allowed }),
    'GET /api/smart/discover': () =>
      json(200, {
        items: [
          { entityId: 'binary_sensor.leak', kind: 'binary_sensor', name: 'Протікання', state: 'off' },
          { entityId: 'sensor.temp', kind: 'sensor', name: 'Температура', state: '21' },
        ],
      }),
    ...extra,
  });

  it('модератору закрито', async () => {
    mockApi(devicesApi(moderator));
    renderApp('/smart/devices');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });

  it('стан HA, дозволені, додавання знайденого з назвою й кімнатою', async () => {
    const { calls } = mockApi(
      devicesApi(admin, {
        'POST /api/smart/allowlist': () => json(201, { id: 'n1', entityId: 'binary_sensor.leak', kind: 'binary_sensor', label: 'Підлога', room: 'Майстерня', enabled: true }),
      }),
    );
    renderApp('/smart/devices');
    expect(await screen.findByText(/Зв’язок є · Лаб · версія 2026\.11\.0/)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Дозволені пристрої' });
    expect(within(list).getByText('Світло · Майстерня · light.ceiling')).toBeInTheDocument();

    const found = await screen.findByRole('list', { name: 'Знайдені пристрої' });
    const row = within(found).getByText('Протікання').closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Додати' }));
    const name = within(row).getByLabelText('Назва в застосунку');
    expect(name).toHaveValue('Протікання');
    await userEvent.clear(name);
    await userEvent.type(name, 'Підлога');
    await userEvent.type(within(row).getByLabelText('Кімната'), 'Майстерня');
    await userEvent.click(within(row).getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({
      entityId: 'binary_sensor.leak',
      kind: 'binary_sensor',
      label: 'Підлога',
      room: 'Майстерня',
    });
  });

  it('прибрати — лише після підтвердження; приховати', async () => {
    const { calls } = mockApi(
      devicesApi(admin, {
        'DELETE /api/smart/allowlist/l1': () => json(200, { ok: true }),
        'PATCH /api/smart/allowlist/l1': () => json(200, { ...allowed[0], enabled: false }),
      }),
    );
    renderApp('/smart/devices');
    const list = await screen.findByRole('list', { name: 'Дозволені пристрої' });
    await userEvent.click(within(list).getByRole('button', { name: 'Приховати' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ enabled: false });

    await userEvent.click(within(list).getByRole('button', { name: 'Прибрати' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(screen.getByRole('group', { name: /Прибрати «Стеля»/ })).getByRole('button', { name: 'Так' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('HA не відповідає: текст за кодом, список дозволених працює', async () => {
    mockApi(
      devicesApi(admin, {
        'GET /api/smart/status': () => json(503, { errorCode: 'SMART_UNAVAILABLE' }),
        'GET /api/smart/discover': () => json(503, { errorCode: 'SMART_UNAVAILABLE' }),
      }),
    );
    renderApp('/smart/devices');
    expect(await screen.findByRole('list', { name: 'Дозволені пристрої' })).toBeInTheDocument();
    expect(await screen.findAllByText(/Home Assistant не відповідає/)).toHaveLength(2);
  });
});

describe('Розумна лабораторія: логіка', () => {
  it('датчики «так/ні» за класом', () => {
    expect(binaryText({ value: 'on', deviceClass: 'motion' })).toBe('Є рух');
    expect(binaryText({ value: 'off', deviceClass: 'door' })).toBe('Зачинено');
    expect(binaryText({ value: 'on', deviceClass: null })).toBe('Увімкнено');
    expect(binaryAlarm({ value: 'on', deviceClass: 'moisture' })).toBe(true);
    expect(binaryAlarm({ value: 'on', deviceClass: 'motion' })).toBe(false);
  });

  it('числа по-українськи, текст як є', () => {
    expect(sensorText({ value: '1653.04', unit: 'kWh' })).toBe('1653 kWh'.replace('1653', (1653).toLocaleString('uk-UA')));
    expect(sensorText({ value: 'eco', unit: null })).toBe('eco');
  });

  it('кімнати в порядку API, без кімнати — окремо', () => {
    expect(byRoom([{ room: 'А' }, { room: '' }, { room: 'А' }]).map(([r, xs]) => [r, xs.length])).toEqual([
      ['А', 2],
      [NO_ROOM, 1],
    ]);
  });
});
