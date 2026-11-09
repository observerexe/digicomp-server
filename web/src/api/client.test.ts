import { describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../test/render';
import { api, onLoggedOut, unwrap, ApiError } from './client';

describe('API-клієнт', () => {
  it('шле заголовок X-DC-Client і cookie того ж походження', async () => {
    const { calls } = mockApi({ 'GET /api/app-config': () => json(200, {}) });
    await api.GET('/api/app-config');
    expect(calls[0]!.headers.get('X-DC-Client')).toBe('web');
  });

  it('на 401 оновлює сесію один раз для всіх паралельних запитів і повторює їх', async () => {
    let refreshed = false;
    const { calls } = mockApi({
      'GET /api/app-config': () => (refreshed ? json(200, { ok: 1 }) : json(401, { errorCode: 'UNAUTHORIZED' })),
      'POST /api/auth/refresh': async () => {
        await new Promise((r) => setTimeout(r, 10));
        refreshed = true;
        return json(200, {});
      },
    });
    const [a, b] = await Promise.all([api.GET('/api/app-config'), api.GET('/api/app-config')]);
    expect(a.response.status).toBe(200);
    expect(b.response.status).toBe(200);
    expect(calls.filter((c) => c.path === '/api/auth/refresh')).toHaveLength(1);
  });

  it('сесію не оновити — повідомляє про вихід і віддає 401', async () => {
    const out = vi.fn();
    const off = onLoggedOut(out);
    mockApi({
      'GET /api/app-config': () => json(401, { errorCode: 'UNAUTHORIZED' }),
      'POST /api/auth/refresh': () => json(401, { errorCode: 'INVALID_REFRESH_TOKEN' }),
    });
    const r = await api.GET('/api/app-config');
    off();
    expect(r.response.status).toBe(401);
    expect(out).toHaveBeenCalledOnce();
  });

  it('401 від входу не запускає оновлення сесії', async () => {
    const { calls } = mockApi({ 'POST /api/auth/login': () => json(401, { errorCode: 'INVALID_CREDENTIALS' }) });
    await expect(unwrap(api.POST('/api/auth/login', { body: { email: 'a@b.c', password: 'x' } }))).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/login']);
  });

  it('помилка мережі — код NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await unwrap(api.GET('/api/app-config')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('NETWORK');
  });
});
