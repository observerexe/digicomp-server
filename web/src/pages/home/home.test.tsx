import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PaperItem, Place, Task } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';
import { busyPlaces, greeting, homeTasks, recentPapers } from './HomePage';

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

const paper = (o: Partial<PaperItem>) =>
  ({
    id: 'd',
    title: 'Документ',
    number: null,
    status: 'published',
    visibility: 'author',
    revision: 1,
    author: { id: 'u2', name: 'Артур Машталер', avatarUrl: null },
    publishedAt: iso(new Date()),
    createdAt: iso(new Date()),
    updatedAt: iso(new Date()),
    ...o,
  }) as PaperItem;

const list = (items: PaperItem[]) => json(200, { items, total: items.length, page: 1, limit: 5 });

/** Query strings of every `GET /api/papers`. */
const queried: string[] = [];

/**
 * «Мої чернетки» — `status=draft`, «Нове про мене» — `about=me`, «Зафіксувати» (staff) — `due=freeze`,
 * «На мій підпис» — `due=sign`, «Завантажити скан» (staff) — `due=scan`.
 */
const papersApi = (drafts: PaperItem[], about: PaperItem[], due: PaperItem[] = [], sign: PaperItem[] = [], scan: PaperItem[] = []) => ({
  'GET /api/papers': (req: Request) => {
    const q = new URL(req.url).searchParams;
    queried.push(q.toString());
    if (q.get('mine') === 'true' && q.get('status') === 'draft') return list(drafts);
    if (q.get('about') === 'me') return list(about);
    if (q.get('due') === 'freeze') return list(due);
    if (q.get('due') === 'sign') return list(sign);
    if (q.get('due') === 'scan') return list(scan);
    return json(400, { errorCode: 'VALIDATION_ERROR' });
  },
});

const homeApi = (opts: { active?: boolean } = {}) => ({
  ...papersApi(
    [paper({ id: 'd1', title: 'Протокол зборів', status: 'draft' })],
    [
      paper({ id: 'd2', title: 'Відомість балів', number: 'ВБ-2026-003' }),
      paper({ id: 'd3', title: 'Подання про стягнення', status: 'cancelled' }),
      paper({ id: 'd4', title: 'Давнє', updatedAt: inDays(-20) }),
    ],
  ),
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

  it('документи: мої чернетки й нове про мене за 14 днів', async () => {
    mockApi(homeApi());
    renderApp('/');
    const drafts = await screen.findByRole('list', { name: 'Мої чернетки' });
    expect(within(drafts).getByRole('link', { name: /Протокол зборів/ })).toHaveAttribute('href', '/editor/d1');
    const news = screen.getByRole('list', { name: 'Нове про мене' });
    expect(
      within(news)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/editor/d2', '/editor/d3']);
    expect(within(news).getByText(/^ВБ-2026-003 · Артур Машталер · /)).toBeInTheDocument();
    expect(within(news).getByText('Артур Машталер · скасовано')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'До Редактора' })).toHaveAttribute('href', '/editor');
  });

  it('модератору — «Зафіксувати»: документи, що чекають фіксації; учасник їх не запитує', async () => {
    queried.length = 0;
    mockApi({
      ...homeApi(),
      'GET /api/auth/me': () => json(200, moderator),
      ...papersApi([], [], [paper({ id: 'f1', title: 'Протокол зборів', number: 'ПЗ-2026-002' })]),
    });
    renderApp('/');
    const due = await screen.findByRole('list', { name: 'Зафіксувати' });
    expect(within(due).getByRole('link')).toHaveAttribute('href', '/editor/f1');
    expect(within(due).getByText(/^ПЗ-2026-002 · Артур Машталер · опубліковано /)).toBeInTheDocument();
    expect(queried.some((q) => q.includes('due=freeze'))).toBe(true);
  });

  it('«На мій підпис» — усім; модератору ще й «Завантажити скан»', async () => {
    queried.length = 0;
    const frozen = paper({ id: 's1', title: 'Технічне завдання', number: 'ТЗ-2026-014', status: 'frozen' });
    mockApi({
      ...homeApi(),
      'GET /api/auth/me': () => json(200, moderator),
      ...papersApi([], [], [], [frozen], [paper({ id: 's2', title: 'Протокол', status: 'frozen' })]),
    });
    renderApp('/');
    const sign = await screen.findByRole('list', { name: 'На мій підпис' });
    expect(within(sign).getByRole('link')).toHaveAttribute('href', '/editor/s1');
    expect(within(sign).getByText(/^ТЗ-2026-014 · Артур Машталер · зафіксовано /)).toBeInTheDocument();
    const scan = screen.getByRole('list', { name: 'Завантажити скан' });
    expect(within(scan).getByRole('link')).toHaveAttribute('href', '/editor/s2');
  });

  it('учасник «Завантажити скан» не запитує; «На мій підпис» — так', async () => {
    queried.length = 0;
    mockApi({ ...homeApi(), ...papersApi([], [], [], [paper({ id: 's1', title: 'Подання', status: 'frozen' })]) });
    renderApp('/');
    await screen.findByRole('list', { name: 'На мій підпис' });
    expect(queried.some((q) => q.includes('due=sign'))).toBe(true);
    expect(queried.some((q) => q.includes('due=scan'))).toBe(false);
  });

  it('учасник «Зафіксувати» не бачить і не запитує', async () => {
    queried.length = 0;
    mockApi(homeApi());
    renderApp('/');
    await screen.findByRole('list', { name: 'Мої чернетки' });
    expect(screen.queryByRole('list', { name: 'Зафіксувати' })).not.toBeInTheDocument();
    expect(queried.some((q) => q.includes('due=freeze'))).toBe(false);
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
      ...papersApi([], [paper({ updatedAt: inDays(-15) })]),
    });
    renderApp('/');
    expect(await screen.findByText('Документів на підпис, чернеток і нових про вас немає.')).toBeInTheDocument();
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

  it('нове про мене: змінене за останні 14 днів', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const items = [paper({ id: 'a', updatedAt: '2026-11-02T12:00:00Z' }), paper({ id: 'b', updatedAt: '2026-11-01T11:59:59Z' })];
    expect(recentPapers(items, now).map((p) => p.id)).toEqual(['a']);
  });

  it('зайняте: без архіву', () => {
    expect(busyPlaces([place({ id: 'a', inUse: true }), place({ id: 'b', inUse: true, status: 'archived' }), place({ id: 'c' })]).map((p) => p.id)).toEqual(['a']);
  });
});
