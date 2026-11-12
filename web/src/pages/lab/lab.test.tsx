import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking, Me, Place, WorkSession } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';
import { daySlots } from './BookingsSection';

// 10:05 in Kyiv on Tuesday, 10 November 2026 (free time starts at 10:15).
const NOW = new Date('2026-11-10T08:05:00Z');
const at = (kyivHour: number, min = 0) => new Date(Date.UTC(2026, 10, 10, kyivHour - 2, min)).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const admin: Me = { ...moderator, id: 'a1', role: 'admin', permissions: [...moderator.permissions, 'sessions.ignore_booking'] };
const staff: Me = {
  ...moderator,
  permissions: [...moderator.permissions, 'places.manage', 'places.authorize', 'sessions.end_other', 'sessions.read_all', 'sessions.export', 'bookings.cancel_any', 'faults.close'],
};

const place = (over: Partial<Place> = {}): Place => ({
  id: '11111111-1111-4111-8111-111111111111',
  code: 'CNC-1',
  title: 'Фрезер ЧПК',
  category: 'Верстати',
  location: 'Майстерня',
  description: '',
  status: 'active',
  needsAuthorization: true,
  exclusive: true,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  inUse: false,
  activeSessions: [],
  myAuthorization: { expiresAt: '2026-12-31T21:00:00Z' },
  ...over,
});

const booking = (who: { id: string; name: string }, from: string, to: string, over: Partial<Booking> = {}): Booking => ({
  id: `b-${from}`,
  startsAt: from,
  endsAt: to,
  note: '',
  createdAt: NOW.toISOString(),
  cancelled: false,
  cancelledAt: null,
  cancelledById: null,
  cancelReason: '',
  user: { ...who, avatarUrl: null },
  place: { id: place().id, code: 'CNC-1', title: 'Фрезер ЧПК' },
  ...over,
});

const session = (over: Partial<WorkSession> = {}): WorkSession => ({
  id: 's1',
  startedAt: at(9, 30),
  endedAt: null,
  endedById: null,
  safetyConfirmed: true,
  note: '',
  equipmentState: '',
  endReason: '',
  autoClosed: false,
  user: { id: member.id, name: member.name },
  place: { id: place().id, code: 'CNC-1', title: 'Фрезер ЧПК' },
  ...over,
});

const andrii = { id: 'u9', name: 'Андрій Шевчук' };

function labApi(me: Me, opts: { place?: Place; bookings?: Booking[]; active?: WorkSession | null } = {}) {
  const state = { active: opts.active ?? null, place: opts.place ?? place() };
  const handlers = {
    'GET /api/auth/me': () => json(200, me),
    'GET /api/places': () =>
      json(200, [
        state.place,
        place({ id: 'p2', code: 'CAM-2', title: 'Камера', category: 'Медіа', needsAuthorization: false, myAuthorization: null, inUse: true, activeSessions: [{ id: 's9', startedAt: at(9), user: andrii }] }),
        place({ id: 'p3', code: 'LAS-1', title: 'Лазер', status: 'maintenance', myAuthorization: null }),
      ]),
    'GET /api/places/CNC-1': () => json(200, state.place),
    [`GET /api/places/${place().id}/bookings`]: () => json(200, opts.bookings ?? []),
    'GET /api/places/CNC-1/sessions/recent': () =>
      json(200, [{ id: 'r1', startedAt: at(8, 2), endedAt: at(9, 48), autoClosed: false, user: { ...andrii, avatarUrl: null } }]),
    'GET /api/faults': () => json(200, { items: [], total: 0, page: 1, limit: 20 }),
    'GET /api/documents': () => json(200, { items: [], total: 0, page: 1, limit: 50 }),
    'GET /api/work-sessions': () => json(200, { items: state.active ? [state.active] : [], total: state.active ? 1 : 0, page: 1, limit: 1 }),
  };
  return { state, handlers };
}

describe('Лабораторія: список', () => {
  it('стан, допуск, пошук і категорії', async () => {
    mockApi(labApi(member).handlers);
    renderApp('/lab');
    const list = await screen.findByRole('list', { name: 'Обладнання' });
    expect(within(list).getByText('Вільне')).toBeInTheDocument();
    expect(within(list).getByText('Зайняте: Андрій Шевчук')).toBeInTheDocument();
    expect(within(list).getByText('На обслуговуванні')).toBeInTheDocument();
    expect(within(list).getByText(/є допуск/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Медіа' }));
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Усі' }));
    await userEvent.type(screen.getByRole('searchbox'), 'las');
    expect(within(list).getByRole('link')).toHaveAttribute('href', '/lab/LAS-1');
  });
});

describe('Сторінка обладнання: сеанс', () => {
  it('старт лише з галочкою, з ключем ідемпотентності; потім «Ви працюєте» і смужка', async () => {
    const { state, handlers } = labApi(member);
    const { calls } = mockApi({
      ...handlers,
      [`POST /api/places/${place().id}/sessions`]: () => {
        state.active = session({ startedAt: at(10, 2) });
        return json(201, state.active);
      },
    });
    renderApp('/lab/CNC-1');
    const startBtn = await screen.findByRole('button', { name: 'Почати роботу' });
    expect(screen.getByText('Ваш допуск діє до 31 груд..')).toBeInTheDocument();
    expect(startBtn).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/інструкцією з безпеки/));
    await userEvent.click(startBtn);

    expect(await screen.findByText(/Ви працюєте з 10:02/)).toBeInTheDocument();
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body) as { safetyConfirmed: boolean; idempotencyKey: string };
    expect(body.safetyConfirmed).toBe(true);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('region', { name: 'Активний сеанс' })).toHaveTextContent('Працюєте на Фрезер ЧПК з 10:02');
  });

  it('завершення з нотаткою', async () => {
    const { state, handlers } = labApi(member, { active: session() });
    const { calls } = mockApi({
      ...handlers,
      'PATCH /api/work-sessions/s1/end': () => {
        state.active = null;
        return json(200, session({ endedAt: at(10) }));
      },
    });
    renderApp('/lab/CNC-1');
    await userEvent.type(await screen.findByLabelText('Нотатка (необов’язково)'), 'Замінив фрезу');
    await userEvent.click(screen.getByRole('button', { name: 'Завершити роботу' }));
    await screen.findByRole('button', { name: 'Почати роботу' });
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ note: 'Замінив фрезу' });
    expect(screen.queryByRole('region', { name: 'Активний сеанс' })).not.toBeInTheDocument();
  });

  it('чуже бронювання зараз блокує старт; пізніше сьогодні — попередження', async () => {
    mockApi(labApi(member, { bookings: [booking(andrii, at(9), at(11))] }).handlers);
    renderApp('/lab/CNC-1');
    expect(await screen.findByText('Зараз бронювання: Андрій Шевчук до 11:00.')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/інструкцією з безпеки/));
    expect(screen.getByRole('button', { name: 'Почати роботу' })).toBeDisabled();
  });

  it('бронювання пізніше сьогодні: «працювати можна до»', async () => {
    mockApi(labApi(member, { bookings: [booking(andrii, at(16), at(18))] }).handlers);
    renderApp('/lab/CNC-1');
    expect(await screen.findByText(/О 16:00 забронював\(-ла\) Андрій Шевчук\. Працювати можна до 15:55\./)).toBeInTheDocument();
  });

  it('адмін може почати попри бронювання', async () => {
    mockApi(labApi(admin, { bookings: [booking(andrii, at(9), at(11))] }).handlers);
    renderApp('/lab/CNC-1');
    expect(await screen.findByText(/можете почати попри бронювання/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/інструкцією з безпеки/));
    expect(screen.getByRole('button', { name: 'Почати роботу' })).toBeEnabled();
  });

  it('без допуску: пояснення, старт вимкнено', async () => {
    mockApi(labApi(member, { place: place({ myAuthorization: null }) }).handlers);
    renderApp('/lab/CNC-1');
    expect(await screen.findByText(/потрібен допуск. Його видає модератор/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/інструкцією з безпеки/));
    expect(screen.getByRole('button', { name: 'Почати роботу' })).toBeDisabled();
  });

  it('модератор завершує чужий сеанс з причиною', async () => {
    const busy = place({ inUse: true, activeSessions: [{ id: 's9', startedAt: at(9), user: andrii }] });
    const { calls } = mockApi({ ...labApi(staff, { place: busy }).handlers, 'PATCH /api/work-sessions/s9/end': () => json(200, session({ id: 's9' })) });
    renderApp('/lab/CNC-1');
    expect(await screen.findByText('Зараз працює Андрій Шевчук з 09:00.')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Завершити сеанс Андрій Шевчук' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Причина завершення чужого сеансу'), 'Забув завершити');
    await userEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ reason: 'Забув завершити' });
  });

  it('останні сеанси видно', async () => {
    mockApi(labApi(member).handlers);
    renderApp('/lab/CNC-1');
    const recent = await screen.findByRole('list', { name: 'Останні сеанси' });
    expect(within(recent).getByText('Андрій Шевчук')).toBeInTheDocument();
    expect(within(recent).getByText('1:46')).toBeInTheDocument();
  });

  it('обладнання немає — зрозумілий текст', async () => {
    mockApi({ ...labApi(member).handlers, 'GET /api/places/NOPE': () => json(404, { errorCode: 'PLACE_NOT_FOUND' }) });
    renderApp('/lab/NOPE');
    expect(await screen.findByRole('heading', { name: 'Обладнання не знайдено' })).toBeInTheDocument();
  });
});

describe('Бронювання', () => {
  it('вільні проміжки між бронюваннями в робочих годинах', () => {
    const slots = daySlots('2026-11-10', [booking(andrii, at(12), at(14))], NOW.getTime());
    expect(slots.map((x) => [x.start.toISOString(), x.end.toISOString(), !!x.booking])).toEqual([
      [at(10, 15), at(12), false],
      [at(12), at(14), true],
      [at(14), at(22), false],
    ]);
  });

  it('форма шле київський час; перетин — текст за кодом', async () => {
    const { calls } = mockApi({ ...labApi(member).handlers, 'POST /api/bookings': () => json(409, { errorCode: 'BOOKING_OVERLAP' }) });
    renderApp('/lab/CNC-1');
    await userEvent.click((await screen.findAllByRole('button', { name: /Вільно$/ }))[0]!);
    const from = screen.getByLabelText('З');
    const to = screen.getByLabelText('До');
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-11-10');
    expect(from).toHaveValue('10:15');
    expect(to).toHaveValue('12:15');
    await userEvent.click(within(screen.getByRole('region', { name: 'Бронювання' }).querySelector('form')!).getByRole('button', { name: 'Забронювати' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Цей час уже заброньовано');
    expect(JSON.parse(calls.find((c) => c.path === '/api/bookings')!.body)).toMatchObject({
      placeId: place().id,
      startsAt: '2026-11-10T08:15:00.000Z',
      endsAt: '2026-11-10T10:15:00.000Z',
    });
  });

  it('кінець раніше за початок — без запиту', async () => {
    const { calls } = mockApi(labApi(member).handlers);
    renderApp('/lab/CNC-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Забронювати' }));
    const to = screen.getByLabelText('До');
    await userEvent.clear(to);
    await userEvent.type(to, '09:00');
    expect(screen.getByRole('alert')).toHaveTextContent('Кінець має бути пізніше за початок.');
    expect(calls.some((c) => c.path === '/api/bookings')).toBe(false);
  });

  it('своє бронювання скасовується одним натиском', async () => {
    const { calls } = mockApi({
      ...labApi(member, { bookings: [booking(member, at(15), at(16))] }).handlers,
      'POST /api/bookings/b-2026-11-10T13:00:00.000Z/cancel': () => json(200, {}),
    });
    renderApp('/lab/CNC-1');
    const mine = (await screen.findByText('Ви')).closest('li')!;
    await userEvent.click(within(mine).getByRole('button', { name: 'Скасувати' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/cancel'))).toBe(true));
  });
});

describe('Несправності', () => {
  it('звіт з фото: спершу звіт, потім фото multipart', async () => {
    const { calls } = mockApi({
      ...labApi(member).handlers,
      'POST /api/faults': () => json(201, { id: 'f1' }),
      'POST /api/faults/f1/photos': () => json(201, { id: 'f1' }),
    });
    renderApp('/lab/CNC-1');
    const section = await screen.findByRole('region', { name: 'Несправності' });
    await userEvent.click(within(section).getByRole('button', { name: 'Несправність' }));
    await userEvent.type(screen.getByLabelText('Що сталося'), 'Люфт осі Z');
    const file = new File([new Uint8Array([1, 2, 3])], 'z.jpg', { type: 'image/jpeg' });
    await userEvent.upload(section.querySelector('input[type=file]') as HTMLInputElement, file);
    expect(screen.getByText('z.jpg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/faults/f1/photos')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/faults' && c.method === 'POST')!.body)).toEqual({ placeId: place().id, description: 'Люфт осі Z' });
    expect(calls.find((c) => c.path === '/api/faults/f1/photos')!.headers.get('content-type')).toMatch(/^multipart\/form-data/);
  });

  it('модератор: на обслуговування однією дією', async () => {
    const fault = {
      id: 'f1', description: 'Шпиндель гуде', status: 'open', resolution: '', place: { id: place().id },
      reporter: { id: 'u1', name: 'Марта Коваль', avatarUrl: null }, closedBy: null, closedAt: null,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), photosCount: 0,
    };
    const { calls } = mockApi({
      ...labApi(staff).handlers,
      'GET /api/faults': () => json(200, { items: [fault], total: 1, page: 1, limit: 20 }),
      'POST /api/faults/f1/maintenance': () => json(200, fault),
    });
    renderApp('/lab/CNC-1');
    await userEvent.click(await screen.findByRole('button', { name: 'На обслуговування' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/faults/f1/maintenance')).toBe(true));
  });

  it('учасник не бачить дій модератора', async () => {
    const fault = {
      id: 'f1', description: 'Шпиндель гуде', status: 'open', resolution: '', place: { id: place().id },
      reporter: null, closedBy: null, closedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), photosCount: 0,
    };
    mockApi({ ...labApi(member).handlers, 'GET /api/faults': () => json(200, { items: [fault], total: 1, page: 1, limit: 20 }) });
    renderApp('/lab/CNC-1');
    expect(await screen.findByText('Шпиндель гуде')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'На обслуговування' })).not.toBeInTheDocument();
  });
});

describe('Сканер, наліпки, журнал', () => {
  it('сканер без камери: ручне введення коду', async () => {
    const { handlers } = labApi(member);
    mockApi(handlers);
    const { router } = renderApp('/scan');
    expect(await screen.findByText(/лише через захищене з’єднання/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Код з наліпки'), 'https://evil.example/lab/CNC-1');
    await userEvent.click(screen.getByRole('button', { name: 'Відкрити' }));
    expect(screen.getByRole('alert')).toHaveTextContent('не з DigiComp HUB');
    await userEvent.clear(screen.getByLabelText('Код з наліпки'));
    await userEvent.type(screen.getByLabelText('Код з наліпки'), 'cnc-1');
    await userEvent.click(screen.getByRole('button', { name: 'Відкрити' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/lab/CNC-1'));
  });

  it('наліпки: учаснику закрито, модератору — QR з повною адресою', async () => {
    mockApi(labApi(member).handlers);
    renderApp('/lab/stickers');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });

  it('наліпки для модератора', async () => {
    mockApi(labApi(staff).handlers);
    renderApp('/lab/stickers');
    const sheet = await screen.findByRole('list', { name: 'Наліпки' });
    await waitFor(() => expect(within(sheet).getAllByRole('img')).toHaveLength(3));
    await userEvent.click(screen.getByRole('checkbox', { name: /Лазер/ }));
    expect(within(sheet).getAllByRole('img')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Друкувати (2)' })).toBeEnabled();
  });

  it('журнал: учасник без вивантаження, модератор — CSV з фільтрами', async () => {
    mockApi(labApi(member).handlers);
    renderApp('/lab/journal');
    expect(await screen.findByRole('heading', { name: 'Мої сеанси' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'CSV' })).not.toBeInTheDocument();
  });

  it('журнал модератора', async () => {
    const { calls } = mockApi({
      ...labApi(staff).handlers,
      'GET /api/users': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
    });
    renderApp('/lab/journal');
    const csv = await screen.findByRole('link', { name: 'CSV' });
    const url = new URL(csv.getAttribute('href')!, location.origin);
    expect(url.pathname).toBe('/api/work-sessions/export.csv');
    // 1 November 00:00 in Kyiv is 31 October 22:00 UTC.
    expect(url.searchParams.get('from')).toBe('2026-10-31T22:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-11-10T22:00:00.000Z');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/work-sessions' && c.method === 'GET')).toBe(true));
  });
});

describe('Обладнання: керування (staff)', () => {
  it('додавання: код обов’язковий, POST і перехід на сторінку', async () => {
    const { handlers } = labApi(staff);
    const { calls } = mockApi({
      ...handlers,
      'POST /api/places': async (req) => json(201, place({ ...((await req.json()) as Partial<Place>), id: 'p9' })),
      'GET /api/places/OSC-2': () => json(200, place({ id: 'p9', code: 'OSC-2', title: 'Осцилограф' })),
    });
    const { router } = renderApp('/lab/new');
    await userEvent.type(await screen.findByLabelText('Назва'), 'Осцилограф');
    await userEvent.type(screen.getByLabelText('Категорія'), 'Вимірювання');
    expect(screen.getByRole('button', { name: 'Додати' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Код (для QR)'), 'OSC-2');
    await userEvent.click(screen.getByLabelText(/Лише один користувач/));
    await userEvent.click(screen.getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/lab/OSC-2'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({
      code: 'OSC-2',
      title: 'Осцилограф',
      category: 'Вимірювання',
      location: '',
      description: '',
      needsAuthorization: true,
      exclusive: false,
    });
  });

  it('редагування: код не змінюється, стан — у PATCH', async () => {
    const { handlers } = labApi(staff);
    const { calls } = mockApi({ ...handlers, [`PATCH /api/places/${place().id}`]: async (req) => json(200, place((await req.json()) as Partial<Place>)) });
    renderApp('/lab/CNC-1/edit');
    expect(await screen.findByLabelText('Назва')).toHaveValue('Фрезер ЧПК');
    expect(screen.queryByLabelText('Код (для QR)')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Стан'), 'archived');
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toMatchObject({ status: 'archived', title: 'Фрезер ЧПК' });
  });

  it('сторінка обладнання: «Редагувати» і допуски — лише staff', async () => {
    const { handlers } = labApi(staff);
    mockApi({ ...handlers, 'GET /api/place-authorizations': () => json(200, []) });
    renderApp('/lab/CNC-1');
    expect(await screen.findByRole('link', { name: 'Редагувати' })).toHaveAttribute('href', '/lab/CNC-1/edit');
    expect(await screen.findByRole('heading', { name: 'Допуски' })).toBeInTheDocument();
  });

  it('учасник не бачить керування; форма закрита', async () => {
    mockApi(labApi(member).handlers);
    renderApp('/lab/CNC-1');
    await screen.findByRole('button', { name: 'Почати роботу' });
    expect(screen.queryByRole('link', { name: 'Редагувати' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Допуски' })).not.toBeInTheDocument();
  });

  it('архів у списку для staff', async () => {
    const { handlers } = labApi(staff);
    mockApi({ ...handlers, 'GET /api/places': () => json(200, [place(), place({ id: 'p4', code: 'OLD-1', title: 'Старий паяльник', status: 'archived' })]) });
    renderApp('/lab');
    const list = await screen.findByRole('list', { name: 'Обладнання' });
    expect(within(list).queryByText('Старий паяльник')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Архів' }));
    expect(within(list).getByText('Старий паяльник')).toBeInTheDocument();
  });
});

describe('Форма обладнання: учасник', () => {
  it('закрита', async () => {
    mockApi(labApi(member).handlers);
    renderApp('/lab/new');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
