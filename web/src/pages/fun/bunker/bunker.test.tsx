import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BunkerGame, BunkerPack, BunkerRoom, Me } from '../../../api/types';
import { json, member, mockApi, renderApp } from '../../../test/render';
import { PERSONAL_KINDS, logText, namer, plural, specialUsable, stayText } from './labels';

const me: Me = { ...member, permissions: [...member.permissions, 'bunker.play'] };
const ref = (id: string, name: string) => ({ id, name, avatarUrl: null, color: 'blue' as const });
const USERS = [ref('u1', 'Марта Коваль'), ref('u2', 'Олена М.'), ref('u3', 'Андрій П.'), ref('u4', 'Назар В.')];

const pack = (over: Partial<BunkerPack> = {}): BunkerPack => ({
  id: 'p-base',
  name: 'Базовий',
  description: '',
  author: null,
  builtin: true,
  canEdit: false,
  cardCount: 254,
  counts: [],
  updatedAt: '',
  ...over,
});

const room = (over: Partial<BunkerRoom> = {}): BunkerRoom => ({
  id: 'r1',
  name: 'Пара після обіду',
  status: 'lobby',
  hostId: 'u1',
  settings: { packIds: ['p-base'], maxPlayers: 8, turnSeconds: 60, hostPlays: true },
  packs: [{ id: 'p-base', name: 'Базовий' }],
  members: USERS.slice(0, 3).map((u) => ({ userId: u.id, online: true })),
  users: USERS,
  game: null,
  now: new Date().toISOString(),
  ...over,
});

const closed = (texts: Partial<Record<string, string>> = {}) => PERSONAL_KINDS.map((kind) => ({ kind, text: texts[kind] ?? null }));

const game = (over: Partial<BunkerGame> = {}): BunkerGame => ({
  round: 2,
  phase: 'turns',
  capacity: 2,
  schedule: [0, 0, 0, 1, 1],
  stayMonths: 24,
  catastrophe: { title: 'Супервулкан', text: 'Попіл усюди.' },
  bunker: [
    { text: 'Три кімнати', round: 1 },
    { text: 'Запас консервів', round: 2 },
    { text: null, round: 3 },
    { text: null, round: 4 },
    { text: null, round: 5 },
  ],
  threat: null,
  players: [
    { userId: 'u1', out: null, left: false, cards: closed({ profession: 'Інженер', hobby: 'Гітара' }), specialUsed: false, special: null },
    { userId: 'u2', out: null, left: false, cards: closed({ profession: 'Лікарка' }), specialUsed: false, special: null },
    { userId: 'u3', out: null, left: false, cards: closed({ profession: 'Кухар' }), specialUsed: false, special: null },
    { userId: 'u4', out: null, left: false, cards: closed({ profession: 'Механік' }), specialUsed: false, special: null },
  ],
  me: {
    cards: PERSONAL_KINDS.map((kind) => ({ kind, text: kind === 'health' ? 'Астма' : `${kind} u1`, revealed: kind === 'profession' || kind === 'hobby' })),
    special: { text: 'Поміняйтеся «Здоров’ям» з будь-ким', effect: 'swap', effectKind: 'health' },
    specialUsed: false,
  },
  turn: { userId: 'u1', revealed: false, deadline: new Date(Date.now() + 42_000).toISOString() },
  queue: ['u1', 'u2', 'u3', 'u4'],
  vote: null,
  immune: [],
  log: [{ at: '', type: 'round', round: 2, text: 'Запас консервів' }],
  ...over,
});

const playing = (g: Partial<BunkerGame> = {}) => room({ status: 'playing', members: USERS.map((u) => ({ userId: u.id, online: true })), game: game(g) });

describe('Бункер: підписи', () => {
  it('множина, термін, хроніка', () => {
    expect(plural(1, 'голос', 'голоси', 'голосів')).toBe('голос');
    expect(plural(3, 'голос', 'голоси', 'голосів')).toBe('голоси');
    expect(plural(12, 'голос', 'голоси', 'голосів')).toBe('голосів');
    expect([6, 12, 24, 60].map(stayText)).toEqual(['пів року', 'рік', '2 роки', '5 років']);
    const name = namer(USERS, 'u1');
    expect(logText({ at: '', type: 'reveal', round: 2, userId: 'u2', kind: 'health', text: 'Астма' }, name)).toBe('Олена М. відкриває «Здоров’я»: Астма');
    expect(logText({ at: '', type: 'out', round: 2, userId: 'u3', tally: [{ userId: 'u3', votes: 5 }] }, name)).toBe('Андрій П. вибуває — 5 голосів');
    // The chronicle names the reader by name: «Ви» does not fit its verbs.
    expect(namer(USERS, undefined)('u1')).toBe('Марта Коваль');
    expect(
      logText(
        {
          at: '',
          type: 'tie',
          round: 2,
          tally: [
            { userId: 'u2', votes: 2 },
            { userId: 'u3', votes: 2 },
            { userId: 'u4', votes: 0 },
          ],
        },
        name,
      ),
    ).toBe('Нічия: Олена М., Андрій П. — переголосування');
  });

  it('коли особлива умова доступна', () => {
    expect(specialUsable('swap', game())).toBe(true);
    expect(specialUsable('double_vote', game())).toBe(false);
    expect(specialUsable('cancel_vote', game({ phase: 'voting', round: 5 }))).toBe(false);
    expect(specialUsable('cancel_vote', game({ phase: 'voting', round: 3 }))).toBe(true);
  });
});

describe('Бункер: розділ', () => {
  const base = {
    'GET /api/auth/me': () => json(200, me),
    'GET /api/bunker/packs': () => json(200, { items: [pack(), pack({ id: 'p-lab', name: 'Лабораторні', builtin: false, canEdit: true, author: USERS[0] })] }),
    'GET /api/bunker/rooms': () =>
      json(200, {
        myRoomId: null,
        items: [
          {
            id: 'r2',
            name: 'Кібер-вечір',
            status: 'lobby',
            host: USERS[2],
            members: [USERS[2], USERS[3]],
            maxPlayers: 10,
            packs: [{ id: 'p-base', name: 'Базовий' }],
            round: null,
            alive: null,
          },
          { id: 'r3', name: 'Субота', status: 'playing', host: USERS[3], members: [], maxPlayers: 8, packs: [], round: 3, alive: 5 },
        ],
      }),
  };

  it('«Розваги» в меню й на сторінці', async () => {
    mockApi(base);
    renderApp('/fun');
    expect(await screen.findByRole('link', { name: /Бункер/ })).toHaveAttribute('href', '/fun/bunker');
    expect(await screen.findByText('Кімната збирає гравців')).toBeInTheDocument();
  });

  it('кімнати: ті, що збирають, і ті, що йдуть; приєднатися веде в кімнату', async () => {
    const { calls } = mockApi({
      ...base,
      'POST /api/bunker/rooms/r2/join': () => json(201, room({ id: 'r2', name: 'Кібер-вечір' })),
      'GET /api/bunker/rooms/r2': () => json(200, room({ id: 'r2', name: 'Кібер-вечір' })),
    });
    const { router } = renderApp('/fun/bunker');
    expect(await screen.findByText('Кібер-вечір')).toBeInTheDocument();
    expect(screen.getByText('Раунд 3 з 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Закрити' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Приєднатися' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/fun/bunker/r2'));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/bunker/rooms/r2/join')).toBe(true);
  });

  it('модератор закриває чужу кімнату зі списку; учасник кнопки не бачить', async () => {
    const mod: Me = { ...me, id: 'm1', role: 'moderator', permissions: [...me.permissions, 'bunker.moderate'] };
    const { calls } = mockApi({ ...base, 'GET /api/auth/me': () => json(200, mod), 'DELETE /api/bunker/rooms/r2': () => json(200, { ok: true }) });
    renderApp('/fun/bunker');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Закрити' }))[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Так' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/bunker/rooms/r2')).toBe(true));
  });

  it('нова кімната: Базовий пак, хід 1 хв, ведучий грає — за замовчуванням', async () => {
    const { calls } = mockApi({ ...base, 'POST /api/bunker/rooms': () => json(201, room()), 'GET /api/bunker/rooms/r1': () => json(200, room()) });
    const { router } = renderApp('/fun/bunker');
    await userEvent.click(await screen.findByRole('button', { name: 'Нова кімната' }));
    const dialog = await screen.findByRole('dialog', { name: 'Нова кімната' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /Базовий/ })).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Створити кімнату' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/fun/bunker/r1'));
    const body = JSON.parse(calls.find((c) => c.method === 'POST' && c.path === '/api/bunker/rooms')!.body) as Record<string, unknown>;
    expect(body).toEqual({ name: 'Кімната Марта', packIds: ['p-base'], maxPlayers: 12, turnSeconds: 60, hostPlays: true });
  });

  it('карти і паки: вбудований лише для перегляду, у свій пак можна додати карту', async () => {
    const detail = (over: object) => ({ ...pack(), cards: [], counts: [], ...over });
    const { calls } = mockApi({
      ...base,
      'GET /api/bunker/packs/p-lab': () => json(200, detail({ id: 'p-lab', name: 'Лабораторні', builtin: false, canEdit: true })),
      'GET /api/bunker/packs/p-base': () => json(200, detail({})),
      'GET /api/bunker/cards': () =>
        json(200, {
          items: [
            {
              id: 'c1',
              kind: 'hobby',
              title: '',
              text: 'Радіоаматор',
              effect: null,
              effectKind: null,
              author: USERS[3],
              builtin: false,
              canEdit: false,
              packCount: 0,
              updatedAt: '',
            },
          ],
          total: 1,
          page: 1,
          limit: 100,
        }),
      'POST /api/bunker/packs/p-lab/cards': () => json(201, detail({ id: 'p-lab', name: 'Лабораторні', builtin: false, canEdit: true, cardCount: 1 })),
    });
    renderApp('/fun/bunker?tab=packs');
    expect(await screen.findByLabelText('Назва паку')).toHaveValue('Лабораторні');
    await userEvent.click(await screen.findByRole('button', { name: 'Додати в пак «Радіоаматор»' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/bunker/packs/p-lab/cards')).toBe(true));
    await userEvent.click(screen.getByRole('link', { name: /Базовий/ }));
    expect(await screen.findByText('Вбудований пак не змінюється. Щоб змінити, зробіть копію.')).toBeInTheDocument();
  });
});

describe('Бункер: кімната', () => {
  it('лобі: почати можна від 4, ведучий бачить кнопку', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => json(200, me),
      'GET /api/bunker/rooms/r1': () => json(200, room()),
      'POST /api/bunker/rooms/r1/start': () => json(201, playing()),
    });
    renderApp('/fun/bunker/r1');
    const start = await screen.findByRole('button', { name: 'Почати гру' });
    expect(start).toBeDisabled();
    expect(screen.getByText('Почати можна від 4 гравців: потрібно ще 1')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/start'))).toBe(false);
  });

  it('мій хід: відкрити карту, завершити — лише після відкриття; чужі закриті не видно', async () => {
    let current = playing();
    const { calls } = mockApi({
      'GET /api/auth/me': () => json(200, me),
      'GET /api/bunker/rooms/r1': () => json(200, current),
      'POST /api/bunker/rooms/r1/actions': () => {
        current = playing({ turn: { userId: 'u1', revealed: true, deadline: null } });
        return json(201, current);
      },
    });
    renderApp('/fun/bunker/r1');
    expect(await screen.findByText('Ваш хід')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/0:4\d/);
    expect(screen.getByRole('button', { name: 'Завершити хід' })).toBeDisabled();
    const cards = screen.getAllByRole('button', { name: 'Відкрити' });
    expect(cards).toHaveLength(6);
    await userEvent.click(cards[0]!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Завершити хід' })).toBeEnabled());
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body) as Record<string, unknown>;
    expect(body).toEqual({ type: 'reveal', kind: 'biology' });
    await userEvent.click(screen.getByRole('tab', { name: /Гравці/ }));
    expect(screen.getByText('Лікарка')).toBeInTheDocument();
    expect(screen.queryByText('Астма')).not.toBeInTheDocument();
  });

  it('голосування: за себе не можна, вибраний іде на сервер', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => json(200, me),
      'GET /api/bunker/rooms/r1': () =>
        json(200, playing({ phase: 'voting', turn: null, queue: [], vote: { candidates: ['u1', 'u2', 'u3', 'u4'], voted: ['u2'], myVote: null, runoff: false, double: false } })),
      'POST /api/bunker/rooms/r1/actions': () =>
        json(
          201,
          playing({ phase: 'voting', turn: null, queue: [], vote: { candidates: ['u1', 'u2', 'u3', 'u4'], voted: ['u1', 'u2'], myVote: 'u3', runoff: false, double: false } }),
        ),
    });
    renderApp('/fun/bunker/r1');
    const vote = await screen.findByRole('group', { name: 'Оберіть гравця' });
    expect(within(vote).getAllByRole('radio')).toHaveLength(3);
    await userEvent.click(within(vote).getByRole('radio', { name: /Андрій П\./ }));
    await userEvent.click(screen.getByRole('button', { name: 'Голосувати проти: Андрій П.' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ type: 'vote', targetId: 'u3' });
  });

  it('особлива умова з обміном питає, на кого', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => json(200, me),
      'GET /api/bunker/rooms/r1': () => json(200, playing()),
      'POST /api/bunker/rooms/r1/actions': () => json(201, playing()),
    });
    renderApp('/fun/bunker/r1');
    await userEvent.click(await screen.findByRole('button', { name: 'Використати' }));
    await userEvent.selectOptions(screen.getByLabelText('На кого'), 'u2');
    await userEvent.click(screen.getByRole('button', { name: 'Застосувати' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ type: 'special', targetId: 'u2' });
  });

  it('на комп’ютері — усе поруч: катастрофа, бункер, хроніка', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('min-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    mockApi({ 'GET /api/auth/me': () => json(200, me), 'GET /api/bunker/rooms/r1': () => json(200, playing()) });
    renderApp('/fun/bunker/r1');
    expect(await screen.findByText('Супервулкан')).toBeInTheDocument();
    expect(screen.getByText('Відкриється в раунді 3')).toBeInTheDocument();
    expect(screen.getByText('Раунд 2. Відкрито бункер: Запас консервів')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Що показати' })).not.toBeInTheDocument();
  });

  it('не в кімнаті — пояснення й шлях назад', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, me), 'GET /api/bunker/rooms/r1': () => json(403, { errorCode: 'BUNKER_NOT_IN_ROOM' }) });
    renderApp('/fun/bunker/r1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ви не в цій кімнаті.');
    expect(screen.getByRole('link', { name: 'До кімнат' })).toBeInTheDocument();
  });
});
