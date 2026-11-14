import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Dictionary, Me } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'dictionaries.manage'] };

const types: Dictionary = {
  id: 'd1',
  key: 'typ_tz',
  title: 'Тип ТЗ',
  required: false,
  createdAt: '2026-11-14T10:00:00Z',
  updatedAt: '2026-11-14T10:00:00Z',
  items: [
    { id: 'i1', key: 'dyzain', title: 'Дизайн', color: 'purple', position: 0, archived: false },
    { id: 'i2', key: 'video', title: 'Відео', color: 'blue', position: 1, archived: false },
    { id: 'i3', key: 'foto', title: 'Фото', color: 'gray', position: 2, archived: true },
  ],
};

describe('Довідники', () => {
  it('список із кольоровими пунктами, архівні не показуються', async () => {
    mockApi({
      'GET /api/auth/me': () => json(200, staff),
      'GET /api/dictionaries': () => json(200, [types]),
    });
    renderApp('/panel/dictionaries');
    const list = await screen.findByRole('list', { name: 'Довідники' });
    const link = within(list).getByRole('link', { name: /Тип ТЗ/ });
    expect(link).toHaveAttribute('href', '/panel/dictionaries/typ_tz');
    expect(link).toHaveTextContent('2 пункти');
    expect(within(link).getByText('Дизайн')).toHaveClass('pal-purple');
    expect(within(link).queryByText('Фото')).not.toBeInTheDocument();
  });

  it('новий довідник відкривається одразу', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => json(200, staff),
      'GET /api/dictionaries': () => json(200, []),
      'POST /api/dictionaries': () => json(201, { ...types, items: [] }),
      'GET /api/dictionaries/typ_tz': () => json(200, { ...types, items: [] }),
    });
    const { router } = renderApp('/panel/dictionaries');
    await userEvent.click(await screen.findByRole('button', { name: 'Новий довідник' }));
    await userEvent.type(screen.getByLabelText('Назва довідника'), 'Тип ТЗ');
    await userEvent.click(screen.getByRole('button', { name: 'Створити' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/panel/dictionaries/typ_tz'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ title: 'Тип ТЗ' });
    // Empty and not required: can be deleted.
    expect(await screen.findByRole('button', { name: 'Видалити' })).toBeInTheDocument();
  });

  it('пункт: додати з кольором, порядок, архів', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => json(200, staff),
      'GET /api/dictionaries/typ_tz': () => json(200, types),
      'POST /api/dictionaries/typ_tz/items': () => json(201, types.items[0]),
      'PUT /api/dictionaries/typ_tz/items/order': () => json(200, types),
      'PATCH /api/dictionaries/typ_tz/items/dyzain': () => json(200, types.items[0]),
    });
    renderApp('/panel/dictionaries/typ_tz');
    const items = await screen.findByRole('list', { name: 'Пункти' });
    expect(screen.queryByRole('button', { name: 'Видалити' })).toBeInTheDocument(); // archived item only
    expect(within(items).getByRole('button', { name: '«Дизайн» вище' })).toBeDisabled();

    await userEvent.click(within(items).getByRole('button', { name: '«Дизайн» нижче' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    // Archived items keep their place at the end.
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body)).toEqual({ keys: ['video', 'dyzain', 'foto'] });

    const add = screen.getByRole('heading', { name: 'Додати пункт' }).parentElement!;
    await userEvent.type(within(add).getByLabelText('Назва'), 'Звук');
    await userEvent.click(within(add).getByRole('radio', { name: 'Зелений' }));
    await userEvent.click(within(add).getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ title: 'Звук', color: 'green' });

    const row = within(items).getByText('Дизайн').closest('div')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Змінити' }));
    await userEvent.click(within(row).getByRole('button', { name: 'В архів' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ archived: true });
  });

  it('пункт у вжитку — пояснення з кодом', async () => {
    mockApi({
      'GET /api/auth/me': () => json(200, staff),
      'GET /api/dictionaries/typ_tz': () => json(200, types),
      'DELETE /api/dictionaries/typ_tz/items/foto': () => json(409, { errorCode: 'DICTIONARY_ITEM_IN_USE' }),
    });
    renderApp('/panel/dictionaries/typ_tz');
    const archived = await screen.findByRole('list', { name: 'В архіві' });
    await userEvent.click(within(archived).getByRole('button', { name: 'Видалити' }));
    await userEvent.click(within(archived).getByRole('button', { name: 'Так' }));
    expect(await screen.findByText(/уже використовується в записах/)).toBeInTheDocument();
  });

  it('учаснику закрито', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, member) });
    renderApp('/panel/dictionaries');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
