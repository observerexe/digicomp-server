import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DisciplineRecord, Me, PointsHistoryEntry, TemplateItem } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';
import { canRevokeRecord } from './DisciplinePage';
import { canRevokeEntry } from './PointsPage';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'points.award', 'discipline.issue'] };
const admin: Me = { ...staff, id: 'a1', role: 'admin' };
const row = (id: string, name: string, total: number, rank: number) => ({ id, name, avatarUrl: null, position: '', total, rank });
const people = [
  { id: member.id, name: member.name, role: 'member', position: '', specialty: '', bio: '', avatarUrl: null },
  { id: staff.id, name: staff.name, role: 'moderator', position: '', specialty: '', bio: '', avatarUrl: null },
  { id: 'u3', name: 'Ірина Бойко', role: 'member', position: '', specialty: '', bio: '', avatarUrl: null },
];
const base = (me: Me) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/users': () => json(200, { items: people, total: 3, page: 1, limit: 100 }),
});

describe('Рейтинг', () => {
  it('топ-3, однакові місця, мій рядок; перемикач періоду', async () => {
    const { calls } = mockApi({
      ...base(member),
      'GET /api/points/leaderboard': (req) =>
        new URL(req.url).searchParams.get('period') === 'all'
          ? json(200, [row('u3', 'Ірина Бойко', 90, 1)])
          : json(200, [row('u3', 'Ірина Бойко', 45, 1), row('u4', 'Андрій', 30, 2), row('u5', 'Софія', 30, 2), row('u6', 'Олег', 10, 4), row(member.id, member.name, 5, 5)]),
    });
    renderApp('/rating');
    const podium = await screen.findByRole('list', { name: 'Топ-3' });
    expect(within(podium).getAllByRole('listitem')).toHaveLength(3);
    expect(within(podium).getAllByText('2')).toHaveLength(2);
    const table = screen.getByRole('list', { name: 'Рейтинг' });
    expect(within(table).getByText('Марта Коваль (ви)')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /Марта/ })).toHaveAttribute('href', '/profile');
    expect(screen.getByText(/Ваше місце:/)).toHaveTextContent('Ваше місце: 5 · 5 балів');
    await userEvent.click(screen.getByRole('button', { name: 'За весь час' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Топ-3' })).getAllByRole('listitem')).toHaveLength(1));
    expect(calls.some((c) => c.path === '/api/points/leaderboard')).toBe(true);
  });
});

describe('Бали (модератор)', () => {
  const sheetTemplate: TemplateItem = {
    id: 'vb',
    title: 'Відомість балів',
    kind: 'creates',
    target: 'points_entry',
    numberPrefix: 'ВБ',
    autoFreeze: true,
    creators: 'staff',
    visibility: 'author',
    archived: false,
    currentVersion: 1,
    draftVersion: null,
    needsUpdate: false,
    about: ['user'],
    createdAt: '2026-11-15T10:00:00Z',
    updatedAt: '2026-11-15T10:00:00Z',
  };

  it('модератор не бачить себе; «Нова відомість» з обраним учасником — він у першому рядку', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'GET /api/points/users/u3': () => json(200, { balance: 0, history: [] }),
      'GET /api/papers/templates': () => json(200, [sheetTemplate]),
      'POST /api/papers': () => json(201, { id: 'p1' }),
    });
    const { router } = renderApp('/points');
    const who = await screen.findByLabelText('Учасник');
    await waitFor(() => expect(within(who).getAllByRole('option')).toHaveLength(3));
    expect(within(who).queryByRole('option', { name: staff.name })).not.toBeInTheDocument();
    await userEvent.selectOptions(who, 'u3');
    await userEvent.click(await screen.findByRole('button', { name: 'Нова відомість' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/p1'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers' && c.method === 'POST')!.body)).toEqual({
      templateId: 'vb',
      about: { type: 'user', id: 'u3' },
    });
  });

  it('в історії — посилання на відомість; нарахування з відомості тут не знімається', async () => {
    const entry: PointsHistoryEntry = {
      id: 'e1', kind: 'manual', amount: 5, reason: 'Чергування', taskId: null, taskTitle: null, reversesId: null,
      createdBy: { id: staff.id, name: staff.name }, paper: { id: 'p9', number: 'ВБ-2026-001' }, revoked: false, createdAt: '2026-11-15T10:00:00Z',
    };
    mockApi({
      ...base(staff),
      'GET /api/points/users/u3': () => json(200, { balance: 5, history: [entry] }),
      'GET /api/papers/templates': () => json(200, [sheetTemplate]),
    });
    renderApp('/points?user=u3');
    const list = await screen.findByRole('list', { name: 'Історія учасника' });
    expect(within(list).getByRole('link', { name: 'Відомість ВБ-2026-001' })).toHaveAttribute('href', '/editor/p9');
    expect(within(list).queryByRole('button', { name: 'Зняти' })).not.toBeInTheDocument();
  });

  it('старе нарахування: «Створити документ» — відомість з ним, одразу в редакторі', async () => {
    const entry: PointsHistoryEntry = {
      id: 'e1', kind: 'manual', amount: 5, reason: 'Чергування', taskId: null, taskTitle: null, reversesId: null,
      createdBy: { id: staff.id, name: staff.name }, paper: null, revoked: false, createdAt: '2026-11-15T10:00:00Z',
    };
    const { calls } = mockApi({
      ...base(staff),
      'GET /api/points/users/u3': () => json(200, { balance: 5, history: [entry] }),
      'GET /api/papers/templates': () => json(200, [sheetTemplate]),
      'POST /api/papers/for-record': () => json(201, { id: 'p5' }),
    });
    const { router } = renderApp('/points?user=u3');
    const list = await screen.findByRole('list', { name: 'Історія учасника' });
    expect(within(list).getByRole('button', { name: 'Зняти' })).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Створити документ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/p5'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers/for-record')!.body)).toEqual({ templateId: 'vb', targetId: 'e1' });
  });

  it('хто може зняти нарахування', () => {
    const e = (over: Partial<PointsHistoryEntry>): PointsHistoryEntry => ({
      id: 'e', kind: 'manual', amount: 10, reason: '', taskId: null, taskTitle: null, reversesId: null,
      createdBy: { id: staff.id, name: staff.name }, paper: null, revoked: false, createdAt: '', ...over,
    });
    expect(canRevokeEntry(e({}), staff)).toBe(true);
    expect(canRevokeEntry(e({ createdBy: { id: 'other', name: 'Інший' } }), staff)).toBe(false);
    expect(canRevokeEntry(e({ createdBy: { id: 'other', name: 'Інший' } }), admin)).toBe(true);
    expect(canRevokeEntry(e({ kind: 'task' }), admin)).toBe(false);
    expect(canRevokeEntry(e({ revoked: true }), admin)).toBe(false);
    expect(canRevokeEntry(e({ paper: { id: 'p9', number: 'ВБ-2026-001' } }), admin)).toBe(false);
  });

  it('учаснику сторінки закриті', async () => {
    mockApi(base(member));
    renderApp('/points');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});

describe('Дисципліна (модератор)', () => {
  const rec = (over: Partial<DisciplineRecord> = {}): DisciplineRecord => ({
    id: 'd1',
    type: 'warning',
    reason: 'Запізнення',
    amount: null,
    user: { id: 'u3', name: 'Ірина Бойко', avatarUrl: null },
    issuedBy: { id: staff.id, name: staff.name, avatarUrl: null },
    createdAt: '2026-11-01T10:00:00Z',
    revoked: false,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    paper: null,
    papers: [],
    ...over,
  });
  const issueTemplate: TemplateItem = {
    id: 'ps',
    title: 'Подання про стягнення',
    kind: 'creates',
    target: 'discipline_record',
    numberPrefix: 'ПС',
    autoFreeze: true,
    creators: 'staff',
    visibility: 'author',
    archived: false,
    currentVersion: 1,
    draftVersion: null,
    needsUpdate: false,
    about: ['user'],
    createdAt: '2026-11-15T10:00:00Z',
    updatedAt: '2026-11-15T10:00:00Z',
  };

  it('«Нове подання» зі сторінки учасника — документ про нього, відкривається в редакторі', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'GET /api/discipline': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
      'GET /api/papers/templates': () => json(200, [issueTemplate]),
      'POST /api/papers': () => json(201, { id: 'p1' }),
    });
    const { router } = renderApp('/discipline?user=u3');
    await userEvent.click(await screen.findByRole('button', { name: 'Нове подання' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/p1'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers' && c.method === 'POST')!.body)).toEqual({
      templateId: 'ps',
      about: { type: 'user', id: 'u3' },
    });
  });

  it('стягнення без документа знімається тут з причиною; з документом — посилання на подання й пояснення', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'GET /api/discipline': () =>
        json(200, {
          items: [
            rec(),
            rec({
              id: 'd2',
              reason: 'Кабель',
              paper: { id: 'p1', number: 'ПС-2026-001' },
              papers: [{ id: 'p2', title: 'Пояснювальна записка', number: null, status: 'draft' }],
            }),
          ],
          total: 2,
          page: 1,
          limit: 100,
        }),
      'GET /api/papers/templates': () => json(200, [issueTemplate]),
      'POST /api/discipline/d1/revoke': () => json(200, rec({ revoked: true })),
    });
    renderApp('/discipline');
    const [old, withPaper] = within(await screen.findByRole('list', { name: 'Записи дисципліни' })).getAllByRole('listitem');
    expect(within(withPaper!).queryByRole('button', { name: 'Зняти' })).not.toBeInTheDocument();
    expect(within(withPaper!).queryByRole('button', { name: 'Створити документ' })).not.toBeInTheDocument();
    expect(within(withPaper!).getByRole('link', { name: 'Подання ПС-2026-001' })).toHaveAttribute('href', '/editor/p1');
    expect(within(withPaper!).getByRole('link', { name: 'Пояснювальна записка · чернетка' })).toHaveAttribute('href', '/editor/p2');

    await userEvent.click(within(old!).getByRole('button', { name: 'Зняти' }));
    await userEvent.type(within(old!).getByLabelText('Причина зняття'), 'Помилка');
    await userEvent.click(within(old!).getByRole('button', { name: 'Зняти запис' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/discipline/d1/revoke')).toBe(true));
  });

  it('старе стягнення: «Створити документ» — подання з нього, одразу в редакторі', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'GET /api/discipline': () => json(200, { items: [rec()], total: 1, page: 1, limit: 100 }),
      'GET /api/papers/templates': () => json(200, [issueTemplate]),
      'POST /api/papers/for-record': () => json(201, { id: 'p7' }),
    });
    const { router } = renderApp('/discipline');
    const list = await screen.findByRole('list', { name: 'Записи дисципліни' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Створити документ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/p7'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers/for-record')!.body)).toEqual({ templateId: 'ps', targetId: 'd1' });
  });

  it('хто може зняти запис тут', () => {
    expect(canRevokeRecord(rec(), staff)).toBe(true);
    expect(canRevokeRecord(rec({ issuedBy: { id: 'x', name: 'Х', avatarUrl: null } }), staff)).toBe(false);
    expect(canRevokeRecord(rec({ issuedBy: { id: 'x', name: 'Х', avatarUrl: null } }), admin)).toBe(true);
    expect(canRevokeRecord(rec({ revoked: true }), admin)).toBe(false);
    expect(canRevokeRecord(rec({ paper: { id: 'p1', number: null } }), admin)).toBe(false);
  });
});
