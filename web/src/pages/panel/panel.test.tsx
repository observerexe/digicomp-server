import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'tasks.accept', 'points.award', 'discipline.issue'] };
const api = (me: Me) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/tasks': () => json(200, [{ id: 't1' }, { id: 't2' }]),
  'GET /api/faults': () => json(200, { items: [], total: 1, page: 1, limit: 1 }),
  'GET /api/inventory/items': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
});

describe('Панель керування', () => {
  it('лічильники, розділи за правами, число в меню', async () => {
    mockApi(api(staff));
    renderApp('/panel');
    const hot = await screen.findByRole('list', { name: 'Потребує уваги' });
    await waitFor(() => expect(within(hot).getByRole('link', { name: /ТЗ на перевірці/ })).toHaveTextContent('2'));
    expect(within(hot).getByRole('link', { name: /несправності/ })).toHaveTextContent('1');
    const sections = screen.getByRole('list', { name: 'Розділи' });
    expect(within(sections).getByRole('link', { name: /Бали/ })).toBeInTheDocument();
    expect(within(sections).queryByRole('link', { name: /Журнал/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('2 ТЗ на перевірці')).toBeInTheDocument();
  });

  it('учаснику закрито', async () => {
    mockApi(api(member));
    renderApp('/panel');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
