import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me, OrgSettings } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'org.manage'] };

const org: OrgSettings = {
  institution: 'КАЛУСЬКИЙ ПОЛІТЕХНІЧНИЙ ФАХОВИЙ КОЛЕДЖ',
  groupName: 'Творча група DigiComp',
  signer: null,
  signerPosition: 'модератор творчої групи DigiComp',
  updatedAt: '',
};

const people = [
  { ...moderator, active: true },
  { ...member, id: 'u2', name: 'Ірина Коваль', position: '', active: true },
];

const base = (me: Me, value: OrgSettings = org) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/org-settings': () => json(200, value),
  'GET /api/users': () => json(200, { items: people, total: people.length, page: 1, limit: 100 }),
});

describe('Реквізити', () => {
  it('модератор вибирає підписантом себе; зберігаються лише змінені поля', async () => {
    const { calls } = mockApi({
      ...base(staff),
      'PATCH /api/org-settings': () => json(200, { ...org, groupName: 'Група', signer: { id: 'm1', name: moderator.name, active: true } }),
    });
    renderApp('/panel/org');
    const group = await screen.findByLabelText('Назва групи');
    expect(screen.getByLabelText('Назва закладу')).toHaveValue(org.institution);
    await userEvent.clear(group);
    await userEvent.type(group, ' Група ');
    const signer = screen.getByLabelText('Учасник');
    await waitFor(() => expect(within(signer).getByRole('option', { name: /Олег Петренко/ })).toBeInTheDocument());
    await userEvent.selectOptions(signer, 'm1');
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    expect(await screen.findByText('Збережено.')).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ groupName: 'Група', signerId: 'm1' });
  });

  it('порожня назва — зберегти не можна', async () => {
    mockApi(base(staff));
    renderApp('/panel/org');
    await userEvent.clear(await screen.findByLabelText('Назва закладу'));
    expect(screen.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
  });

  it('заблокований підписант — підказка; помилка за кодом', async () => {
    mockApi({
      ...base(staff, { ...org, signer: { id: 'gone', name: 'Артур Машталер', active: false } }),
      'PATCH /api/org-settings': () => json(400, { errorCode: 'ORG_SIGNER_INVALID' }),
    });
    renderApp('/panel/org');
    expect(await screen.findByText('Підписанта (Артур Машталер) заблоковано — виберіть іншого.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ірина Коваль' })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Учасник'), 'u2');
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    expect(await screen.findByText(/Підписанта не знайдено або його заблоковано/)).toBeInTheDocument();
  });

  it('учаснику закрито', async () => {
    mockApi(base(member));
    renderApp('/panel/org');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
