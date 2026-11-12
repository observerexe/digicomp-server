import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Fault, Me } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'faults.close'] };

const fault = (over: Partial<Fault>): Fault => ({
  id: 'f1',
  description: 'Люфт осі Z',
  status: 'open',
  resolution: '',
  place: { id: 'p1', code: 'CNC-1', title: 'Фрезер', status: 'active' },
  reporter: { id: 'u1', name: 'Марта', avatarUrl: null },
  closedBy: null,
  closedAt: null,
  photosCount: 0,
  createdAt: '2026-11-05T10:00:00Z',
  updatedAt: '2026-11-05T10:00:00Z',
  ...over,
});

function faultsApi(me: Me) {
  return mockApi({
    'GET /api/auth/me': () => json(200, me),
    'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    'GET /api/faults': (req) => {
      const st = new URL(req.url).searchParams.get('status');
      const items =
        st === 'open'
          ? [fault({})]
          : [fault({ id: 'f2', status: 'in_progress', description: 'Не гріється стіл', createdAt: '2026-11-01T10:00:00Z', place: { id: 'p2', code: 'PR-3', title: '3D-принтер', status: 'maintenance' } })];
      return json(200, { items, total: items.length, page: 1, limit: 100 });
    },
    'POST /api/faults/f1/in-progress': () => json(200, fault({ status: 'in_progress' })),
  });
}

describe('Панель: несправності', () => {
  it('відкриті й у роботі, найстаріші зверху, з посиланням на обладнання; дія «В роботі»', async () => {
    const { calls } = faultsApi(staff);
    renderApp('/panel/faults');
    const list = await screen.findByRole('list', { name: 'Відкриті несправності' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Не гріється стіл');
    expect(within(rows[0]!).getByRole('link', { name: '3D-принтер' })).toHaveAttribute('href', '/lab/PR-3');
    // On maintenance already: no «На обслуговування».
    expect(within(rows[0]!).queryByRole('button', { name: 'На обслуговування' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Відкрито' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(within(list).getByRole('button', { name: 'В роботі' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/faults/f1/in-progress')).toBe(true));
  });

  it('учаснику закрито', async () => {
    faultsApi(member);
    renderApp('/panel/faults');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
