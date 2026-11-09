import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { Me } from '../api/types';
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
