import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Place, Task } from '../../api/types';
import { json, member, mockApi, renderApp } from '../../test/render';
import { busyPlaces, greeting, homeTasks } from './HomePage';

const iso = (d: Date) => d.toISOString();
const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

const task = (o: Partial<Task>) =>
  ({
    id: 't',
    title: 'ТЗ',
    status: 'in_progress',
    points: 10,
    dueDate: null,
    maxAssignees: 1,
    assignees: [{ id: member.id, name: member.name, avatarUrl: null }],
    updatedAt: iso(new Date()),
    ...o,
  }) as Task;

const place = (o: Partial<Place>) =>
  ({
    id: 'p',
    code: 'CNC-1',
    title: 'ЧПК',
    category: '',
    location: '',
    status: 'active',
    inUse: false,
    activeSessions: [],
    ...o,
  }) as Place;

const homeApi = (opts: { active?: boolean } = {}) => ({
  'GET /api/auth/me': () => json(200, member),
  'GET /api/work-sessions': () =>
    json(200, {
      items: opts.active
        ? [{ id: 's1', startedAt: iso(new Date(Date.now() - 90 * 60_000)), endedAt: null, place: { id: 'p1', code: 'CNC-1', title: 'Фрезер ЧПК' }, user: { id: member.id } }]
        : [],
      total: opts.active ? 1 : 0,
      page: 1,
      limit: 1,
    }),
  'GET /api/tasks': () =>
    json(200, [
      task({ id: 't1', title: 'Без дедлайну' }),
      task({ id: 't2', title: 'Монтаж ролика', dueDate: inDays(3) }),
      task({ id: 't3', title: 'Готове', status: 'done' }),
      task({ id: 't4', title: 'Прострочене', status: 'review', dueDate: inDays(-2) }),
    ]),
  'GET /api/places': () =>
    json(200, [
      place({ id: 'p1', title: 'Фрезер ЧПК' }),
      place({
        id: 'p2',
        code: 'CAM-2',
        title: 'Камера',
        inUse: true,
        activeSessions: [{ id: 's9', startedAt: iso(new Date()), user: { id: 'u4', name: 'Андрій Шевчук' } }],
      }),
    ]),
  'GET /api/points/me': () => json(200, { balance: 340, history: [] }),
  'GET /api/points/leaderboard': () => json(200, [{ id: member.id, name: member.name, avatarUrl: null, position: '', total: 340, rank: 4 }]),
  'GET /api/bookings/me': () =>
    json(200, [
      {
        id: 'b1',
        startsAt: inDays(1),
        endsAt: inDays(1.1),
        note: '',
        cancelled: false,
        user: { id: member.id },
        place: { id: 'p2', code: 'CAM-2', title: 'Камера' },
      },
    ]),
});

describe('Головна', () => {
  it('мої ТЗ за дедлайном, бали, зайняте обладнання, бронювання', async () => {
    mockApi(homeApi());
    renderApp('/');
    const tasks = await screen.findByRole('list', { name: 'Мої ТЗ' });
    const titles = within(tasks)
      .getAllByRole('link')
      .map((a) => a.querySelector('span span')?.textContent);
    expect(titles).toEqual(['Прострочене', 'Монтаж ролика', 'Без дедлайну']);
    expect(within(tasks).getByText('прострочено')).toBeInTheDocument();

    expect(await screen.findByText('340')).toBeInTheDocument();
    expect(await screen.findByText(/^4 місце за /)).toBeInTheDocument();

    const busy = await screen.findByRole('list', { name: 'Зайняте обладнання' });
    expect(within(busy).getByText('Камера')).toBeInTheDocument();
    expect(within(busy).getByText(/Андрій Шевчук/)).toBeInTheDocument();
    expect(within(busy).queryByText('Фрезер ЧПК')).not.toBeInTheDocument();

    const bookings = await screen.findByRole('list', { name: 'Мої бронювання' });
    expect(within(bookings).getByRole('link', { name: /Камера/ })).toHaveAttribute('href', '/lab/CAM-2');

    expect(screen.getByText('Зараз ви не працюєте на обладнанні')).toBeInTheDocument();
    expect(screen.queryByText(/Тут будуть/)).not.toBeInTheDocument();
  });

  it('активний сеанс — посилання на обладнання', async () => {
    mockApi(homeApi({ active: true }));
    renderApp('/');
    const card = await screen.findByRole('region', { name: 'Мій сеанс' });
    expect(within(card).getByText('Працюєте на Фрезер ЧПК')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'До обладнання' })).toHaveAttribute('href', '/lab/CNC-1');
  });

  it('порожні стани з підказкою, що робити', async () => {
    mockApi({
      ...homeApi(),
      'GET /api/tasks': () => json(200, []),
      'GET /api/places': () => json(200, []),
      'GET /api/bookings/me': () => json(200, []),
    });
    renderApp('/');
    expect(await screen.findByText('Активних ТЗ немає. Вільні ТЗ — на дошці.')).toBeInTheDocument();
    expect(await screen.findByText('Усе обладнання вільне.')).toBeInTheDocument();
    expect(await screen.findByText(/Бронювань немає/)).toBeInTheDocument();
  });

  it('помилка одного блоку не ховає інші', async () => {
    mockApi({ ...homeApi(), 'GET /api/points/me': () => json(500, { errorCode: 'INTERNAL_ERROR' }) });
    renderApp('/');
    expect(await screen.findByRole('list', { name: 'Мої ТЗ' })).toBeInTheDocument();
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });
});

describe('Головна: логіка', () => {
  it('привітання за київським часом', () => {
    expect(greeting(new Date('2026-11-12T06:00:00Z'))).toBe('Доброго ранку'); // 08:00 Kyiv
    expect(greeting(new Date('2026-11-12T12:00:00Z'))).toBe('Добрий день');
    expect(greeting(new Date('2026-11-12T18:00:00Z'))).toBe('Добрий вечір');
    expect(greeting(new Date('2026-11-12T00:30:00Z'))).toBe('Доброї ночі');
  });

  it('ТЗ: без виконаних, найближчий дедлайн спершу', () => {
    const r = homeTasks([task({ id: 'a' }), task({ id: 'b', dueDate: inDays(5) }), task({ id: 'c', status: 'done' }), task({ id: 'd', dueDate: inDays(1) })]);
    expect(r.map((t) => t.id)).toEqual(['d', 'b', 'a']);
  });

  it('зайняте: без архіву', () => {
    expect(busyPlaces([place({ id: 'a', inUse: true }), place({ id: 'b', inUse: true, status: 'archived' }), place({ id: 'c' })]).map((p) => p.id)).toEqual(['a']);
  });
});
