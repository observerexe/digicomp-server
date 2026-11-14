import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { FieldDef, Me, PaletteColor } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { routes } from '../routes';

export const member: Me = {
  id: 'u1',
  email: 'marta@test',
  name: 'Марта Коваль',
  role: 'member',
  position: 'Відеографиня',
  specialty: 'Медіа',
  bio: '',
  avatarUrl: null,
  active: true,
  twoFactorEnabled: false,
  permissions: ['tasks.take', 'places.read'],
};

export const moderator: Me = { ...member, id: 'm1', name: 'Олег Петренко', role: 'moderator', permissions: [...member.permissions, 'users.manage', 'profile.edit_own_role_info'] };

type Handler = (req: Request) => Response | Promise<Response>;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Routes fetch calls to handlers by "METHOD /path"; records every call. */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: { method: string; path: string; headers: Headers; body: string }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), location.origin), init);
    const path = new URL(req.url).pathname;
    calls.push({ method: req.method, path, headers: req.headers, body: await req.clone().text() });
    const h = handlers[`${req.method} ${path}`];
    return h ? h(req) : json(404, { errorCode: 'NOT_FOUND' });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { router, qc };
}

/** Handler for GET /api/dictionaries/:key with items in the given order. */
export function dictionary(key: string, items: { key: string; title: string; archived?: boolean; color?: PaletteColor }[]): Record<string, Handler> {
  return {
    [`GET /api/dictionaries/${key}`]: () =>
      json(200, {
        id: key,
        key,
        title: key,
        required: true,
        items: items.map((i, position) => ({ id: i.key, color: 'gray', position, archived: false, ...i })),
        createdAt: '',
        updatedAt: '',
      }),
  };
}

/** An extra field of tasks («Налаштування полів»): «Тип» from the dictionary typ_tz. */
export const fieldDef = (over: Partial<FieldDef> = {}): FieldDef => ({
  id: 'f1',
  key: 'typ',
  label: 'Тип',
  type: 'enum',
  required: false,
  dictionary: 'typ_tz',
  min: null,
  max: null,
  maxLength: null,
  maxItems: null,
  position: 0,
  archived: false,
  ...over,
});
