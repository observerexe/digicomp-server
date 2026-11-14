import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/types';
import { fieldDef, json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'records.fields_manage', 'dictionaries.manage'] };

const typ = fieldDef();
const hours = fieldDef({ id: 'f2', key: 'hours', label: 'Години', type: 'int', dictionary: null, min: 1, max: 40, required: true, position: 1 });
const old = fieldDef({ id: 'f3', key: 'old', label: 'Старе', type: 'text', dictionary: null, archived: true, position: 2 });

const base = (me: Me) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/records/task/schema': () => json(200, { type: 'task', label: 'ТЗ', extensible: true, version: 'v', fields: [] }),
  'GET /api/records/task/field-defs': () => json(200, [typ, hours, old]),
  'GET /api/dictionaries': () =>
    json(200, [{ id: 'd1', key: 'typ_tz', title: 'Тип ТЗ', required: true, items: [], createdAt: '', updatedAt: '' }]),
});

describe('Налаштування полів', () => {
  it('поля з типом, довідником і обов’язковістю; архів окремо', async () => {
    mockApi(base(staff));
    renderApp('/panel/fields/task');
    expect(await screen.findByRole('heading', { name: 'Налаштування полів: ТЗ' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Поля' });
    await waitFor(() => expect(within(list).getByText('Вибір з довідника · Тип ТЗ')).toBeInTheDocument());
    expect(within(list).getByText("Ціле число · обов'язкове")).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'В архіві' })).getByText('Старе')).toBeInTheDocument();
  });

  it('нове поле «Вибір з довідника»: без довідника не додати', async () => {
    const { calls } = mockApi({ ...base(staff), 'POST /api/records/task/field-defs': () => json(201, typ) });
    renderApp('/panel/fields/task');
    const add = (await screen.findByRole('heading', { name: 'Додати поле' })).parentElement!;
    await userEvent.type(within(add).getByLabelText('Назва'), 'Складність');
    expect(within(add).getByRole('button', { name: 'Додати' })).toBeDisabled();
    await waitFor(() => expect(within(add).getByRole('option', { name: 'Тип ТЗ' })).toBeInTheDocument());
    await userEvent.selectOptions(within(add).getByLabelText('Довідник'), 'typ_tz');
    await userEvent.click(within(add).getByLabelText("Обов'язкове"));
    await userEvent.click(within(add).getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({
      label: 'Складність',
      required: true,
      type: 'enum',
      dictionary: 'typ_tz',
    });
  });

  it('нове числове поле: межі; зміна типу не стирає назву', async () => {
    const { calls } = mockApi({ ...base(staff), 'POST /api/records/task/field-defs': () => json(201, hours) });
    renderApp('/panel/fields/task');
    const add = (await screen.findByRole('heading', { name: 'Додати поле' })).parentElement!;
    await userEvent.type(within(add).getByLabelText('Назва'), 'Години');
    await userEvent.selectOptions(within(add).getByLabelText('Тип'), 'int');
    expect(within(add).getByLabelText('Назва')).toHaveValue('Години');
    await userEvent.type(within(add).getByLabelText('Найменше'), '5');
    await userEvent.type(within(add).getByLabelText('Найбільше'), '2');
    expect(within(add).getByRole('button', { name: 'Додати' })).toBeDisabled();
    await userEvent.clear(within(add).getByLabelText('Найбільше'));
    await userEvent.type(within(add).getByLabelText('Найбільше'), '40');
    await userEvent.click(within(add).getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ label: 'Години', required: false, min: 5, max: 40, type: 'int' });
  });

  it('порядок, зміна меж, архів', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'PUT /api/records/task/field-defs/order': () => json(200, [hours, typ, old]),
      'PATCH /api/records/task/field-defs/hours': () => json(200, hours),
      'PATCH /api/records/task/field-defs/typ': () => json(200, typ),
    });
    renderApp('/panel/fields/task');
    const list = await screen.findByRole('list', { name: 'Поля' });
    expect(within(list).getByRole('button', { name: '«Тип» вище' })).toBeDisabled();
    await userEvent.click(within(list).getByRole('button', { name: '«Тип» нижче' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    // Archived fields keep their place at the end.
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body)).toEqual({ keys: ['hours', 'typ', 'old'] });

    const row = within(list).getByText('Години').closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Змінити' }));
    await userEvent.clear(within(row).getByLabelText('Найбільше'));
    await userEvent.click(within(row).getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/hours'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path.endsWith('/hours'))!.body)).toEqual({ label: 'Години', required: true, min: 1, max: null });

    const typRow = within(list).getByText('Тип').closest('li')!;
    await userEvent.click(within(typRow).getByRole('button', { name: 'Змінити' }));
    await userEvent.click(within(typRow).getByRole('button', { name: 'В архів' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/typ'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path.endsWith('/typ'))!.body)).toEqual({ archived: true });
  });

  it('поле зі значеннями не видаляється — пояснення з кодом', async () => {
    mockApi({ ...base(staff), 'DELETE /api/records/task/field-defs/old': () => json(409, { errorCode: 'FIELD_DEF_IN_USE' }) });
    renderApp('/panel/fields/task');
    const archived = await screen.findByRole('list', { name: 'В архіві' });
    await userEvent.click(within(archived).getByRole('button', { name: 'Видалити' }));
    await userEvent.click(within(archived).getByRole('button', { name: 'Так' }));
    expect(await screen.findByText(/Перенесіть його в архів/)).toBeInTheDocument();
  });

  it('плитка на панелі', async () => {
    mockApi({
      ...base(staff),
      'GET /api/tasks': () => json(200, []),
      'GET /api/faults': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
      'GET /api/inventory/items': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
      'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    });
    renderApp('/panel');
    const sections = await screen.findByRole('list', { name: 'Розділи' });
    expect(within(sections).getByRole('link', { name: /Налаштування полів/ })).toHaveAttribute('href', '/panel/fields/task');
  });

  it('учаснику закрито', async () => {
    mockApi(base(member));
    renderApp('/panel/fields/task');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
