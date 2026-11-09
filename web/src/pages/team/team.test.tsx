import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { UserListItem } from '../../api/types';
import { json, member, mockApi, renderApp } from '../../test/render';

const card = (id: string, name: string, specialty: string, extra: Partial<UserListItem> = {}): UserListItem => ({
  id,
  name,
  role: 'member',
  position: 'Учасник',
  specialty,
  bio: '',
  avatarUrl: null,
  ...extra,
});

const team = [
  card(member.id, member.name, 'Медіа'),
  card('u2', 'Олег Петренко', 'Інженерія', { role: 'moderator', position: 'Керівник', bio: 'Веду групу.' }),
  card('u3', 'Ірина Бойко', 'Медіа', { position: 'Фотографиня' }),
  card('u4', 'Андрій Шевчук', 'Інженерія', { position: 'Схемотехнік' }),
];

const base = {
  'GET /api/auth/me': () => json(200, member),
  'GET /api/users': () => json(200, { items: team, total: team.length, page: 1, limit: 100 }),
};

const names = () =>
  within(screen.getByRole('list', { name: 'Учасники' }))
    .getAllByRole('link')
    .map((a) => a.textContent);

describe('Команда', () => {
  it('картки, пошук і фільтр за спеціальністю', async () => {
    mockApi(base);
    renderApp('/team');
    await screen.findByText('Олег Петренко');
    expect(names()).toHaveLength(4);
    expect(screen.getByText('Веду групу.')).toBeInTheDocument();
    expect(screen.getByText('Модератор')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Інженерія' }));
    expect(names().join()).toMatch(/Олег.*Андрій/);
    expect(names()).toHaveLength(2);

    await userEvent.type(screen.getByRole('searchbox'), 'схемо');
    expect(names()).toHaveLength(1);
    expect(names()[0]).toContain('Андрій Шевчук');

    await userEvent.click(screen.getByRole('button', { name: 'Усі' }));
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'нікого');
    expect(screen.getByText(/Нікого не знайдено/)).toBeInTheDocument();
  });

  it('своя картка веде в мій профіль, чужа — у публічний', async () => {
    mockApi(base);
    renderApp('/team');
    const list = await screen.findByRole('list', { name: 'Учасники' });
    expect(within(list).getByRole('link', { name: /Марта Коваль/ })).toHaveAttribute('href', '/profile');
    expect(within(list).getByRole('link', { name: /Ірина Бойко/ })).toHaveAttribute('href', '/team/u3');
  });

  it('чужий профіль: лише публічне й бали', async () => {
    mockApi({
      ...base,
      'GET /api/users/u2': () => json(200, { ...team[1], pointsTotal: 21 }),
    });
    renderApp('/team/u2');
    expect(await screen.findByRole('heading', { name: 'Олег Петренко' })).toBeInTheDocument();
    expect(screen.getByText('Веду групу.')).toBeInTheDocument();
    expect(screen.getByText(/бал за весь час/)).toHaveTextContent('21 бал за весь час');
    // No private sections and no management buttons.
    expect(screen.queryByText(/Попередження/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('учасника немає: зрозумілий текст', async () => {
    mockApi({ ...base, 'GET /api/users/gone': () => json(404, { errorCode: 'USER_NOT_FOUND' }) });
    renderApp('/team/gone');
    expect(await screen.findByRole('heading', { name: 'Учасника не знайдено' })).toBeInTheDocument();
  });

  it('свій id у /team/:id відкриває мій профіль', async () => {
    mockApi({ ...base, 'GET /api/points/me': () => json(200, { balance: 0, history: [] }) });
    const { router } = renderApp(`/team/${member.id}`);
    await screen.findByRole('heading', { name: 'Профіль' });
    expect(router.state.location.pathname).toBe('/profile');
  });
});
