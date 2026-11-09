import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DisciplineRecord, Me, PointsHistoryEntry } from '../../api/types';
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
  it('модератор не бачить себе; нарахування; помилка за кодом', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'GET /api/points/users/u3': () => json(200, { balance: 0, history: [] }),
      'POST /api/points/award': () => json(201, { id: 'p1', userId: 'u3', amount: 15, kind: 'manual', reason: 'x', taskId: null, createdById: staff.id, reversesId: null, createdAt: '' }),
    });
    renderApp('/points');
    const who = await screen.findByLabelText('Кому');
    await waitFor(() => expect(within(who).getAllByRole('option')).toHaveLength(3));
    expect(within(who).queryByRole('option', { name: staff.name })).not.toBeInTheDocument();
    await userEvent.selectOptions(who, 'u3');
    await userEvent.clear(screen.getByLabelText('Скільки балів'));
    await userEvent.type(screen.getByLabelText('Скільки балів'), '15');
    await userEvent.type(screen.getByLabelText('За що'), 'Чергування');
    await userEvent.click(screen.getByRole('button', { name: 'Нарахувати' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Нараховано +15.');
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ userId: 'u3', amount: 15, reason: 'Чергування' });
  });

  it('хто може зняти нарахування', () => {
    const e = (over: Partial<PointsHistoryEntry>): PointsHistoryEntry => ({
      id: 'e', kind: 'manual', amount: 10, reason: '', taskId: null, taskTitle: null, reversesId: null,
      createdBy: { id: staff.id, name: staff.name }, revoked: false, createdAt: '', ...over,
    });
    expect(canRevokeEntry(e({}), staff)).toBe(true);
    expect(canRevokeEntry(e({ createdBy: { id: 'other', name: 'Інший' } }), staff)).toBe(false);
    expect(canRevokeEntry(e({ createdBy: { id: 'other', name: 'Інший' } }), admin)).toBe(true);
    expect(canRevokeEntry(e({ kind: 'task' }), admin)).toBe(false);
    expect(canRevokeEntry(e({ revoked: true }), admin)).toBe(false);
  });

  it('учаснику сторінки закриті', async () => {
    mockApi(base(member));
    renderApp('/points');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});

describe('Дисципліна (модератор)', () => {
  const rec = (over: Partial<DisciplineRecord> = {}): DisciplineRecord => ({
    id: 'd1', type: 'warning', reason: 'Запізнення', amount: null,
    user: { id: 'u3', name: 'Ірина Бойко', avatarUrl: null }, issuedBy: { id: staff.id, name: staff.name, avatarUrl: null },
    createdAt: '2026-11-01T10:00:00Z', revoked: false, revokedAt: null, revokedBy: null, revokeReason: null, ...over,
  });

  it('штраф вимагає суму; видача; зняття з причиною', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'GET /api/discipline': () => json(200, { items: [rec()], total: 1, page: 1, limit: 100 }),
      'POST /api/discipline': () => json(201, rec()),
      'POST /api/discipline/d1/revoke': () => json(200, rec({ revoked: true })),
    });
    renderApp('/discipline?user=u3');
    expect(await screen.findByText('Запізнення')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Штраф'));
    await userEvent.clear(screen.getByLabelText('Скільки балів зняти'));
    await userEvent.type(screen.getByLabelText('Причина'), 'Не повернула камеру');
    expect(screen.getByRole('button', { name: 'Видати' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Скільки балів зняти'), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Видати' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/discipline' && c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/discipline' && c.method === 'POST')!.body)).toEqual({
      userId: 'u3', type: 'fine', reason: 'Не повернула камеру', amount: 15,
    });

    const item = within(screen.getByRole('list', { name: 'Записи дисципліни' })).getByRole('listitem');
    await userEvent.click(within(item).getByRole('button', { name: 'Зняти' }));
    await userEvent.type(within(item).getByLabelText('Причина зняття'), 'Помилка');
    await userEvent.click(within(item).getByRole('button', { name: 'Зняти запис' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/discipline/d1/revoke')).toBe(true));
  });

  it('хто може зняти запис', () => {
    expect(canRevokeRecord(rec(), staff)).toBe(true);
    expect(canRevokeRecord(rec({ issuedBy: { id: 'x', name: 'Х', avatarUrl: null } }), staff)).toBe(false);
    expect(canRevokeRecord(rec({ issuedBy: { id: 'x', name: 'Х', avatarUrl: null } }), admin)).toBe(true);
    expect(canRevokeRecord(rec({ revoked: true }), admin)).toBe(false);
  });
});
