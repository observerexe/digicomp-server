import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InventoryItem, Me, TemplateItem } from '../../api/types';
import { dictionary, json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'inventory.manage', 'places.manage'] };
const item = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'i1', code: 'PLY-3', title: 'Фанера 3 мм', category: 'materialy', quantity: 5, unit: 'шт', minQuantity: 0, lowStock: false,
  location: 'Шафа 2', notes: '', createdById: null, createdAt: '', updatedAt: '', ...over,
});
const base = (me: Me, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/auth/me': () => json(200, me),
  ...dictionary('inventory_category', [
    { key: 'materialy', title: 'Матеріали' },
    { key: 'khimiia', title: 'Хімія' },
  ]),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/projects': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
  'GET /api/inventory/movements': () => json(200, { items: [], total: 0, page: 1, limit: 20 }),
  'GET /api/links': () => json(200, { canLink: false, items: [] }),
  'GET /api/inventory/items': () =>
    json(200, { items: [item(), item({ id: 'i2', code: 'PLA-1', title: 'PLA пластик', unit: 'кг', quantity: 0.4, minQuantity: 1, lowStock: true })], total: 2, page: 1, limit: 100 }),
  'GET /api/inventory/items/PLY-3': () => json(200, item()),
  'GET /api/inventory/items/ply-3': () => json(200, item()),
  ...extra,
});

describe('Склад', () => {
  it('список: залишки, «мало», фільтр', async () => {
    mockApi(base(member));
    renderApp('/inventory');
    const list = await screen.findByRole('list', { name: 'Позиції складу' });
    expect(within(list).getByText('0,4 кг')).toBeInTheDocument();
    expect(within(list).getByText('мало')).toBeInTheDocument();
    expect(await within(list).findByText('Матеріали · Шафа 2 · PLY-3')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Лише ті, яких мало (1)'));
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Нова позиція' })).not.toBeInTheDocument();
  });

  it('взяти: ціле число для «шт», не більше залишку, коментар обов’язковий; ключ ідемпотентності', async () => {
    const { calls } = mockApi(
      base(member, {
        'POST /api/inventory/items/i1/movements': () => json(201, { id: 'm1', itemId: 'i1', delta: -2, quantityAfter: 3, note: 'Корпус', projectId: null, actor: { id: member.id }, createdAt: '' }),
      }),
    );
    renderApp('/inventory/ply-3');
    const amount = await screen.findByLabelText('Кількість, шт');
    await userEvent.clear(amount);
    await userEvent.type(amount, '1.5');
    expect(screen.getByRole('alert')).toHaveTextContent('Для «шт» — лише ціле число.');
    await userEvent.clear(amount);
    await userEvent.type(amount, '9');
    expect(screen.getByRole('alert')).toHaveTextContent('На складі лише 5 шт.');
    await userEvent.clear(amount);
    await userEvent.type(amount, '2');
    expect(screen.getAllByRole('button', { name: 'Взяти' }).at(-1)).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Для чого'), 'Корпус');
    await userEvent.click(screen.getAllByRole('button', { name: 'Взяти' }).at(-1)!);
    expect(await screen.findByRole('status')).toHaveTextContent('Взято: 2 шт. Залишок 3 шт.');
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body) as Record<string, unknown>;
    expect(body).toMatchObject({ delta: -2, note: 'Корпус' });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('нестача на сервері — текст за кодом', async () => {
    mockApi(base(member, { 'POST /api/inventory/items/i1/movements': () => json(409, { errorCode: 'INSUFFICIENT_STOCK' }) }));
    renderApp('/inventory/PLY-3');
    await userEvent.type(await screen.findByLabelText('Для чого'), 'Корпус');
    await userEvent.click(screen.getAllByRole('button', { name: 'Взяти' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('На складі недостатньо.');
  });

  it('поповнити шле додатне число', async () => {
    const { calls } = mockApi(
      base(member, {
        'POST /api/inventory/items/i1/movements': () => json(201, { id: 'm1', itemId: 'i1', delta: 10, quantityAfter: 15, note: 'x', projectId: null, actor: { id: member.id }, createdAt: '' }),
      }),
    );
    renderApp('/inventory/PLY-3');
    await userEvent.click(await screen.findByRole('button', { name: 'Поповнити' }));
    await userEvent.clear(screen.getByLabelText('Кількість, шт'));
    await userEvent.type(screen.getByLabelText('Кількість, шт'), '10');
    await userEvent.type(screen.getByLabelText('Звідки'), 'Купили');
    await userEvent.click(screen.getAllByRole('button', { name: 'Поповнити' }).at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toMatchObject({ delta: 10 });
  });

  it('модератор списує за актом: позиція — в першому рядку; рух за актом веде на акт', async () => {
    const act: TemplateItem = {
      id: 'as', title: 'Акт списання', kind: 'creates', target: 'inventory_writeoff', numberPrefix: 'АС', autoFreeze: true, creators: 'staff', visibility: 'members',
      archived: false, currentVersion: 1, draftVersion: null, needsUpdate: false, about: ['inventory_item'], createdAt: '', updatedAt: '',
    };
    const { calls } = mockApi(
      base(staff, {
        'GET /api/papers/templates': () => json(200, [act]),
        'GET /api/inventory/movements': () =>
          json(200, {
            items: [{ id: 'm1', itemId: 'i1', delta: -2, quantityAfter: 3, note: 'Тріснула', projectId: null, paper: { id: 'p9', number: 'АС-2026-001' }, actor: { id: staff.id, name: staff.name }, createdAt: '2026-11-16T10:00:00Z' }],
            total: 1, page: 1, limit: 20,
          }),
        'POST /api/papers': () => json(201, { id: 'p1' }),
      }),
    );
    const { router } = renderApp('/inventory/PLY-3');
    expect(await screen.findByRole('link', { name: 'Акт АС-2026-001' })).toHaveAttribute('href', '/editor/p9');
    await userEvent.click(await screen.findByRole('button', { name: 'Списати за актом' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/p1'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers' && c.method === 'POST')!.body)).toEqual({ templateId: 'as', about: { type: 'inventory_item', id: 'i1' } });
  });

  it('модератор видаляє позицію: залишок спишеться — сказано в питанні', async () => {
    const { calls } = mockApi(base(staff, { 'DELETE /api/inventory/items/i1': () => json(200, { ok: true }) }));
    const { router } = renderApp('/inventory/PLY-3');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Видалити' }));
    const ask = screen.getByRole('group', { name: 'Видалити «Фанера 3 мм» у кошик? Залишок 5 шт спишеться.' });
    await user.click(within(ask).getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory'));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/inventory/items/i1')).toBe(true);
  });

  it('без залишку — питання без списання', async () => {
    mockApi(base(staff, { 'GET /api/inventory/items/PLY-3': () => json(200, item({ quantity: 0 })) }));
    renderApp('/inventory/PLY-3');
    await userEvent.click(await screen.findByRole('button', { name: 'Видалити' }));
    expect(screen.getByRole('group', { name: 'Видалити «Фанера 3 мм» у кошик?' })).toBeInTheDocument();
  });

  it('видалена позиція за QR — «Позицію видалено»', async () => {
    mockApi(base(member, { 'GET /api/inventory/items/OLD-1': () => json(404, { errorCode: 'ITEM_DELETED' }) }));
    renderApp('/inventory/OLD-1');
    expect(await screen.findByRole('heading', { name: 'Позицію видалено' })).toBeInTheDocument();
  });

  it('учасник не бачить «Списати за актом»', async () => {
    mockApi(base(member));
    renderApp('/inventory/PLY-3');
    await screen.findByLabelText('Для чого');
    expect(screen.queryByRole('button', { name: 'Списати за актом' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Видалити' })).not.toBeInTheDocument();
  });

  it('нова позиція: лише модератор; код перевіряється', async () => {
    const { calls } = mockApi(base(staff, { 'POST /api/inventory/items': () => json(201, item({ code: 'NEW-1' })), 'GET /api/inventory/items/NEW-1': () => json(200, item({ code: 'NEW-1' })) }));
    const { router } = renderApp('/inventory/new');
    await userEvent.type(await screen.findByLabelText('Код (для QR)'), 'нова');
    await userEvent.type(screen.getByLabelText('Назва'), 'Клей');
    expect(screen.getByRole('alert')).toHaveTextContent('Код — 2–60 латинських');
    await userEvent.clear(screen.getByLabelText('Код (для QR)'));
    await userEvent.type(screen.getByLabelText('Код (для QR)'), 'NEW-1');
    await waitFor(() => expect(screen.getByLabelText('Категорія')).toBeEnabled());
    await userEvent.selectOptions(screen.getByLabelText('Категорія'), 'Хімія');
    await userEvent.click(screen.getByRole('button', { name: 'Створити' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/NEW-1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toMatchObject({ code: 'NEW-1', title: 'Клей', category: 'khimiia', unit: 'шт', quantity: 0 });
  });

  it('учаснику форма закрита', async () => {
    mockApi(base(member));
    renderApp('/inventory/new');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });

  it('наліпки складу: QR з адресою позиції', async () => {
    mockApi({ ...base(staff), 'GET /api/places': () => json(200, []) });
    renderApp('/lab/stickers?kind=items');
    const sheet = await screen.findByRole('list', { name: 'Наліпки' });
    await waitFor(() => expect(within(sheet).getAllByRole('img')).toHaveLength(2));
    expect(within(sheet).getByText('PLA-1')).toBeInTheDocument();
  });
});
