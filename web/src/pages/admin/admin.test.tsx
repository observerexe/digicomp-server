import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Me } from '../../api/types';
import { json, mockApi, moderator, renderApp } from '../../test/render';
import { POLL } from './AdminPage';
import { containerTone, formatAgo, formatBytes, formatUptime, type AuditEntry, type PanelJob, type PanelOverview } from './labels';

const admin: Me = {
  ...moderator,
  id: 'a1',
  name: 'Ірина Адмін',
  role: 'admin',
  twoFactorEnabled: true,
  permissions: [...moderator.permissions, 'admin.panel', 'audit.read'],
};

const GB = 1024 ** 3;
const overview = (over: Partial<PanelOverview> = {}): PanelOverview => ({
  metrics: {
    cpuPercent: 12.5,
    cpuCount: 4,
    load: [0.5, 0.4, 0.3],
    memory: { totalBytes: 8 * GB, usedBytes: 7.6 * GB, availableBytes: 0.4 * GB },
    disks: [{ path: '/', totalBytes: 100 * GB, usedBytes: 40 * GB, freeBytes: 60 * GB }],
    uptimeSeconds: 3 * 86400 + 4 * 3600,
    collectedAt: new Date().toISOString(),
  },
  containers: [
    { name: 'api', state: 'running', health: 'healthy', status: 'Up 3 days' },
    { name: 'db', state: 'running', health: null, status: 'Up 3 days' },
    { name: 'homeassistant', state: 'exited', health: null, status: '' },
  ],
  lastBackup: { found: true, count: 7, file: 'db-x.dump', sizeBytes: 5 * 1024 * 1024, at: new Date(Date.now() - 40 * 3_600_000).toISOString() },
  ...over,
});

const job = (over: Partial<PanelJob> = {}): PanelJob => ({
  id: 'abcdef12',
  action: 'backup',
  status: 'running',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  output: [],
  ...over,
});

type H = Record<string, (req: Request) => Response | Promise<Response>>;
const base = (me: Me, extra: H = {}): H => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/admin-panel/overview': () => json(200, overview()),
  'GET /api/admin-panel/logs': () => json(200, { lines: ['GET /health 200', 'ERROR db timeout', 'POST /api/tasks 201'], ok: true }),
  ...extra,
});

beforeEach(() => {
  POLL.intervalMs = 5;
  POLL.overviewMs = 15_000;
  POLL.restartWaitMs = 5000;
});

describe('Розширена панель', () => {
  it('огляд: ресурси, контейнери, застарілий бекап, логи з пошуком', async () => {
    mockApi(base(admin));
    renderApp('/admin');
    expect(await screen.findByRole('meter', { name: 'Пам’ять' })).toHaveAttribute('aria-valuenow', '95');
    expect(screen.getByText('7,6 ГБ з 8 ГБ')).toBeInTheDocument();
    const containers = screen.getByRole('list', { name: 'Контейнери' });
    expect(within(containers).getByText('Home Assistant').closest('li')).toHaveTextContent('зупинено (exited)');
    expect(screen.getByText('застарів')).toBeInTheDocument();
    expect(screen.getByText(/3 д 4 год/)).toBeInTheDocument();

    const log = await screen.findByLabelText('Рядки логу');
    expect(log).toHaveTextContent('ERROR db timeout');
    await userEvent.type(screen.getByLabelText('Пошук'), 'error');
    expect(log).toHaveTextContent(/^ERROR db timeout$/);
  });

  it('поза tailnet (404): посилання на адресу панелі', async () => {
    mockApi(base(admin, { 'GET /api/admin-panel/overview': () => json(404, { errorCode: 'NOT_FOUND' }) }));
    renderApp('/admin');
    expect(await screen.findByRole('link', { name: 'Відкрити панель' })).toHaveAttribute('href', 'https://localhost:9443/admin');
    expect(screen.queryByRole('heading', { name: 'Дії' })).not.toBeInTheDocument();
  });

  it('вхід без коду 2FA: вийти й увійти знову; без 2FA — увімкнути', async () => {
    const need2fa = { 'GET /api/admin-panel/overview': () => json(403, { errorCode: 'TWO_FACTOR_REQUIRED' }) };
    mockApi(base(admin, need2fa));
    const { router } = renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Вийти й увійти з кодом' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));

    mockApi(base({ ...admin, twoFactorEnabled: false }, need2fa));
    renderApp('/admin');
    expect(await screen.findByRole('link', { name: 'Увімкнути 2FA' })).toHaveAttribute('href', '/profile/2fa');
  });

  it('агент не відповідає: текст за кодом, журнал доступний', async () => {
    mockApi(base(admin, { 'GET /api/admin-panel/overview': () => json(503, { errorCode: 'AGENT_UNAVAILABLE' }) }));
    renderApp('/admin');
    expect(await screen.findByText(/Агент на сервері не відповідає/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Журнал дій' })).toHaveAttribute('href', '/admin/audit');
  });

  it('бекап: підтвердження, опитування задачі, вивід', async () => {
    let polls = 0;
    const { calls } = mockApi(
      base(admin, {
        'POST /api/admin-panel/actions/backup': () => json(202, job()),
        'GET /api/admin-panel/jobs/abcdef12': () =>
          json(200, ++polls < 2 ? job() : job({ status: 'succeeded', exitCode: 0, finishedAt: new Date().toISOString(), output: ['backup ok: db-x.dump'] })),
      }),
    );
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Бекап' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(within(screen.getByRole('group', { name: /Зробити бекап/ })).getByRole('button', { name: 'Так' }));
    expect(await screen.findByText('готово')).toBeInTheDocument();
    expect(screen.getByText('backup ok: db-x.dump')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перезапуск API' })).toBeEnabled();
  });

  it('перезапуск API: сервер зникає й повертається — сторінка дочікується', async () => {
    let polls = 0;
    const { calls } = mockApi(
      base(admin, {
        'POST /api/admin-panel/actions/restart': () => json(202, job({ action: 'restart-api' })),
        'GET /api/admin-panel/jobs/abcdef12': () => {
          polls++;
          if (polls === 1) throw new TypeError('Failed to fetch');
          if (polls === 2) return json(502, {});
          return json(200, job({ action: 'restart-api', status: 'succeeded', exitCode: 0, finishedAt: new Date().toISOString() }));
        },
      }),
    );
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Перезапуск API' }));
    await userEvent.click(within(screen.getByRole('group', { name: /Перезапустити API/ })).getByRole('button', { name: 'Так' }));
    expect(await screen.findByText('готово')).toBeInTheDocument();
    expect(polls).toBe(3);
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ target: 'api' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('огляд після 429 оновлюється далі, а не завмирає', async () => {
    POLL.overviewMs = 5;
    let n = 0;
    mockApi(base(admin, { 'GET /api/admin-panel/overview': () => (++n === 1 ? json(429, { errorCode: 'TOO_MANY_REQUESTS' }) : json(200, overview())) }));
    renderApp('/admin');
    expect(await screen.findByRole('meter', { name: 'Пам’ять' })).toBeInTheDocument();
    expect(n).toBeGreaterThan(1);
  });

  it('бекап без розміру: без порожнього « ·  · »', async () => {
    mockApi(
      base(admin, {
        'GET /api/admin-panel/overview': () =>
          json(200, overview({ lastBackup: { found: true, count: 3, file: 'x', at: new Date(Date.now() - 3_600_000).toISOString() } })),
      }),
    );
    renderApp('/admin');
    const line = (await screen.findByText(/файлів 3/)).textContent ?? '';
    expect(line).not.toMatch(/·\s*·/);
  });

  it('після перезапуску 429 і 401 — чекаємо далі, а не «помилка»', async () => {
    let polls = 0;
    mockApi(
      base(admin, {
        'POST /api/auth/refresh': () => json(200, {}),
        'POST /api/admin-panel/actions/restart': () => json(202, job({ action: 'restart-api' })),
        'GET /api/admin-panel/jobs/abcdef12': () => {
          polls++;
          if (polls === 1) return json(429, { errorCode: 'TOO_MANY_REQUESTS' });
          if (polls <= 3) return json(401, { errorCode: 'UNAUTHORIZED' });
          return json(200, job({ action: 'restart-api', status: 'succeeded', exitCode: 0, finishedAt: new Date().toISOString() }));
        },
      }),
    );
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Перезапуск API' }));
    await userEvent.click(within(screen.getByRole('group', { name: /Перезапустити API/ })).getByRole('button', { name: 'Так' }));
    expect(await screen.findByText('готово')).toBeInTheDocument();
    expect(screen.queryByText(/помилка/)).not.toBeInTheDocument();
  });

  it('агент забув задачу (404): «невідомо», а не «помилка»', async () => {
    mockApi(
      base(admin, {
        'POST /api/admin-panel/actions/backup': () => json(202, job()),
        'GET /api/admin-panel/jobs/abcdef12': () => json(404, { errorCode: 'NOT_FOUND' }),
      }),
    );
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Бекап' }));
    await userEvent.click(within(screen.getByRole('group', { name: /Зробити бекап/ })).getByRole('button', { name: 'Так' }));
    expect(await screen.findByText('невідомо')).toBeInTheDocument();
    expect(screen.getByText(/могла виконатись успішно/)).toBeInTheDocument();
    expect(screen.queryByText(/^помилка/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Бекап' })).toBeEnabled();
  });

  it('інша дія вже йде: текст AGENT_BUSY', async () => {
    mockApi(base(admin, { 'POST /api/admin-panel/actions/restore-check': () => json(409, { errorCode: 'AGENT_BUSY' }) }));
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Перевірка відновлення' }));
    await userEvent.click(within(screen.getByRole('group', { name: /Перевірити відновлення/ })).getByRole('button', { name: 'Так' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('вже виконується інша дія');
  });

  it('модератору закрито, пункту в меню немає', async () => {
    mockApi(base(moderator));
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Розширена панель' })).not.toBeInTheDocument();
  });
});

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 'e1',
  actorId: 'm1',
  actor: { id: 'm1', name: 'Олег Петренко' },
  action: 'authorization.granted',
  entity: 'place',
  entityId: 'p1',
  meta: { userId: 'u2', expiresAt: null },
  createdAt: '2026-11-10T08:00:00Z',
  ...over,
});

describe('Журнал дій', () => {
  it('людські назви, «Сервер», посилання, фільтр і «Показати ще»', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => entry({ id: `e${i}` }));
    page1[0] = entry({ id: 'e0', action: 'session.auto_closed', actorId: null, actor: null, entity: 'session', meta: null });
    let before: string | null = null;
    mockApi({
      ...base(admin),
      'GET /api/users': () => json(200, { items: [{ ...moderator, id: 'm1' }], total: 1, page: 1, limit: 100 }),
      'GET /api/audit': (req) => {
        const p = new URL(req.url).searchParams;
        before = p.get('before') ?? before;
        if (p.get('before')) return json(200, [entry({ id: 'last', action: 'user.password_reset', entity: 'user', entityId: 'u2' })]);
        if (p.get('action') === 'user.') return json(200, []);
        return json(200, page1);
      },
    });
    renderApp('/admin/audit');
    const list = await screen.findByRole('list', { name: 'Записи журналу' });
    const first = within(list).getAllByRole('listitem')[0]!;
    expect(first).toHaveTextContent('Сеанс закрито автоматично');
    expect(first).toHaveTextContent('Сервер');
    expect(within(list).getAllByText('Видав допуск')[0]!.closest('li')).toHaveTextContent('userId: u2');
    expect(within(list).getAllByRole('link', { name: 'Відкрити' })[0]).toHaveAttribute('href', '/lab/p1');

    await userEvent.click(screen.getByRole('button', { name: 'Показати ще' }));
    expect(await within(list).findByText('Скинув пароль')).toBeInTheDocument();
    expect(before).toBe('e49');
    expect(screen.queryByRole('button', { name: 'Показати ще' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Що'), 'user.');
    expect(await screen.findByText(/Записів немає/)).toBeInTheDocument();
  });
  it('«Хто»: усі учасники, не лише перша сотня; дія міграції — з підписом', async () => {
    const people = Array.from({ length: 130 }, (_, i) => ({ ...moderator, id: `u${i}`, name: `Учасник ${i}` }));
    mockApi({
      ...base(admin),
      'GET /api/users': (req) => {
        const page = Number(new URL(req.url).searchParams.get('page') ?? 1);
        return json(200, { items: people.slice((page - 1) * 100, page * 100), total: people.length, page, limit: 100 });
      },
      'GET /api/audit': () => json(200, [entry({ id: 'm', action: 'project.stage_migrated', actorId: null, actor: null, entity: 'project' })]),
    });
    renderApp('/admin/audit');
    expect(await screen.findByText('Етап проєкту перенесено зі старого статусу')).toBeInTheDocument();
    const who = screen.getByLabelText('Хто');
    await waitFor(() => expect(within(who).getAllByRole('option')).toHaveLength(131));
    expect(within(who).getByRole('option', { name: 'Учасник 129' })).toBeInTheDocument();
  });
});

describe('Форматування панелі', () => {
  it('байти, аптайм, «тому», стан контейнера', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1.5 * GB)).toBe('1,5 ГБ');
    expect(formatUptime(125 * 60)).toBe('2 год 5 хв');
    expect(formatAgo(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3 год тому');
    expect(containerTone({ state: 'running', health: 'starting' })).toBe('warn');
    expect(containerTone({ state: 'running', health: null })).toBe('ok');
    expect(containerTone({ state: 'missing', health: null })).toBe('bad');
  });
});
