import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me, TrashItem } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const mod: Me = { ...moderator, permissions: [...moderator.permissions, 'trash.manage'] };
const admin: Me = { ...mod, id: 'a1', role: 'admin', permissions: [...mod.permissions, 'trash.purge'] };
const row = (over: Partial<TrashItem> = {}): TrashItem => ({
  type: 'place', id: 'p1', title: 'Фрезер ЧПК', code: 'CNC-1', deletedAt: '2026-11-17T10:00:00Z',
  deletedBy: { id: 'm1', name: 'Олег Петренко' }, purgeAt: '2027-02-15T10:00:00Z', ...over,
});
const page = (items: TrashItem[], over: { total?: number; page?: number } = {}) => ({ items, total: over.total ?? items.length, page: over.page ?? 1, limit: 50 });

function api(me: Me, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  return {
    'GET /api/auth/me': () => json(200, me),
    'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    'GET /api/trash': () => json(200, page([row(), row({ type: 'document', id: 'd1', title: 'Паспорт', code: null, deletedBy: null })])),
    ...extra,
  };
}

describe('Кошик', () => {
  it('рядки: тип, код, хто й коли, коли назавжди; модератор лише відновлює', async () => {
    mockApi(api(mod));
    renderApp('/panel/trash');
    const list = await screen.findByRole('list', { name: 'Видалене' });
    const [place, doc] = within(list).getAllByRole('listitem');
    expect(within(place!).getByText('Обладнання')).toBeInTheDocument();
    expect(within(place!).getByText(/^код CNC-1 · видалив\(-ла\) Олег Петренко, .* · назавжди — 15 лют\. 2027/)).toBeInTheDocument();
    expect(within(doc!).getByText('Файл Архіву')).toBeInTheDocument();
    expect(within(doc!).getByText(/^видалив\(-ла\) видалений обліковий запис/)).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: 'Відновити' })).toHaveLength(2);
    expect(within(list).queryByRole('button', { name: 'Видалити назавжди' })).not.toBeInTheDocument();
  });

  it('«Відновити»: запит, рядок зникає, посилання на відновлене', async () => {
    let restored = false;
    const { calls } = mockApi(
      api(mod, {
        'GET /api/trash': () => json(200, page(restored ? [] : [row()])),
        'POST /api/trash/place/p1/restore': () => {
          restored = true;
          return json(200, { ok: true });
        },
      }),
    );
    renderApp('/panel/trash');
    await userEvent.click(await screen.findByRole('button', { name: 'Відновити' }));
    expect(await screen.findByRole('link', { name: 'Фрезер ЧПК' })).toHaveAttribute('href', '/lab/CNC-1');
    expect(await screen.findByText(/Кошик порожній/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/trash/place/p1/restore')).toBe(true);
  });

  it('адмін: «Видалити назавжди» з підтвердженням', async () => {
    const { calls } = mockApi(api(admin, { 'DELETE /api/trash/document/d1': () => json(200, { ok: true }) }));
    renderApp('/panel/trash');
    const doc = within(await screen.findByRole('list', { name: 'Видалене' })).getAllByRole('listitem')[1]!;
    await userEvent.click(within(doc).getByRole('button', { name: 'Видалити назавжди' }));
    const ask = within(doc).getByRole('group', { name: 'Видалити «Паспорт» назавжди? Повернути вже не вийде.' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(ask).getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/trash/document/d1')).toBe(true));
  });

  it('помилка — текст за кодом у рядку', async () => {
    mockApi(api(mod, { 'POST /api/trash/place/p1/restore': () => json(409, { errorCode: 'TRASH_NOT_DELETED' }) }));
    renderApp('/panel/trash');
    await userEvent.click((await screen.findAllByRole('button', { name: 'Відновити' }))[0]!);
    expect(await screen.findByText('Запису вже немає в кошику. Оновіть сторінку.')).toBeInTheDocument();
  });

  it('фільтр типу й пошук ідуть на сервер; порожньо з фільтром — «нічого не знайдено»', async () => {
    const { calls } = mockApi(api(mod, { 'GET /api/trash': (r) => json(200, page(new URL(r.url).searchParams.has('type') ? [] : [row()])) }));
    renderApp('/panel/trash');
    await screen.findByRole('list', { name: 'Видалене' });
    await userEvent.click(screen.getByRole('button', { name: 'Склад' }));
    expect(await screen.findByText('Нічого не знайдено. Спробуйте прибрати фільтр.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'фанера');
    await waitFor(() => {
      const last = new URL(calls.filter((c) => c.path === '/api/trash').at(-1)!.url).searchParams;
      expect([last.get('type'), last.get('search')]).toEqual(['inventory_item', 'фанера']);
    });
  });

  it('«Показати ще» — наступна сторінка', async () => {
    mockApi(
      api(mod, {
        'GET /api/trash': (r) =>
          new URL(r.url).searchParams.get('page') === '2'
            ? json(200, page([row({ id: 'p2', title: 'Лазер', code: 'LAS-1' })], { total: 51, page: 2 }))
            : json(200, page([row()], { total: 51 })),
      }),
    );
    renderApp('/panel/trash');
    await userEvent.click(await screen.findByRole('button', { name: 'Показати ще' }));
    expect(await screen.findByText('Лазер')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показати ще' })).not.toBeInTheDocument();
  });

  it('плитка на панелі — за правом', async () => {
    mockApi({
      ...api(mod),
      'GET /api/tasks': () => json(200, []),
      'GET /api/faults': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
      'GET /api/inventory/items': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    });
    renderApp('/panel');
    const sections = await screen.findByRole('list', { name: 'Розділи' });
    expect(within(sections).getByRole('link', { name: /Кошик/ })).toHaveAttribute('href', '/panel/trash');
  });

  it('учаснику закрито', async () => {
    mockApi(api(member));
    renderApp('/panel/trash');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
