import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Me } from '../api/types';
import { json, member, mockApi, renderApp } from '../test/render';

// Гість: розваги, рейтинг, огляд ТЗ і проєктів; решта — «Немає доступу».
const guest: Me = {
  ...member,
  id: 'g1',
  name: 'Гість Тест',
  role: 'guest',
  permissions: ['bunker.play', 'rating.read', 'tasks.overview', 'projects.overview', 'profile.change_password', 'profile.two_factor'],
};

const base = {
  'GET /api/auth/me': () => json(200, guest),
  'GET /api/bunker/rooms': () => json(200, { items: [], myRoomId: null }),
  'GET /api/tasks/overview': () =>
    json(200, [
      {
        id: 't1',
        title: 'Відео про лабораторію',
        status: 'in_progress',
        points: 20,
        maxAssignees: 2,
        dueDate: null,
        type: { title: 'Відео', color: 'purple' },
        assignees: [{ id: 'u2', name: 'Олена М.', avatarUrl: null, color: 'teal' }],
      },
    ]),
  'GET /api/projects/overview': () => json(200, [{ id: 'p1', title: 'Фестиваль', stage: 'planning', progress: 40, deadline: null, members: [] }]),
};

describe('Гість', () => {
  it('головна — це Розваги; у меню лише його розділи, без QR і лабораторії', async () => {
    mockApi(base);
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/fun'));
    const navs = await screen.findAllByRole('navigation', { name: 'Основна навігація' });
    for (const nav of navs) {
      expect(within(nav).getByRole('link', { name: /Розваги/ })).toBeInTheDocument();
      expect(within(nav).getByRole('link', { name: /Рейтинг/ })).toBeInTheDocument();
      expect(within(nav).queryByRole('link', { name: /Лабораторія/ })).not.toBeInTheDocument();
      expect(within(nav).queryByRole('link', { name: 'Сканувати QR' })).not.toBeInTheDocument();
    }
  });

  it('технічні завдання — огляд: де яке й хто виконує, картка не відкривається', async () => {
    mockApi(base);
    renderApp('/tasks');
    expect(await screen.findByText('Відео про лабораторію')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Відео про лабораторію' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Відео').length).toBeGreaterThan(0);
    expect(screen.getByText('1 з 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Нове технічне завдання/ })).not.toBeInTheDocument();
  });

  it('проєкти — огляд без переходу в проєкт', async () => {
    mockApi(base);
    renderApp('/projects');
    expect(await screen.findByText('Фестиваль')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Фестиваль' })).not.toBeInTheDocument();
  });

  it('картка ТЗ і розділи команди — «Немає доступу» з поясненням для гостя', async () => {
    mockApi(base);
    renderApp('/tasks/t1');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
    expect(screen.getByText(/для учасників команди/)).toBeInTheDocument();
  });

  it('профіль без балів, дисципліни й «Моє»', async () => {
    mockApi(base);
    renderApp('/profile');
    expect(await screen.findByRole('heading', { name: 'Гість Тест' })).toBeInTheDocument();
    expect(screen.queryByText('Баланс')).not.toBeInTheDocument();
    expect(screen.queryByText('Моє')).not.toBeInTheDocument();
  });
});
