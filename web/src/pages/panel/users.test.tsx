import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me, TemplateItem, UserDetail } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const STAFF = ['users.manage', 'users.read_extended', 'users.create', 'users.block', 'users.promote', 'users.edit_role_info', 'places.authorize', 'places.manage'];
const ADMIN = [
  'users.grant_admin',
  'users.reset_password',
  'users.reset_two_factor',
  'users.edit_name',
  'users.edit_email',
  'users.moderate_content',
  'users.manage_moderator',
  'users.edit_color',
];
const mod: Me = { ...moderator, permissions: [...moderator.permissions, ...STAFF] };
const admin: Me = { ...mod, id: 'a1', name: 'Ірина Адмін', role: 'admin', permissions: [...mod.permissions, ...ADMIN] };

const person = (over: Partial<UserDetail> = {}): UserDetail => ({
  id: 'u2',
  name: 'Андрій Шевчук',
  role: 'member',
  position: 'Інженер',
  specialty: 'Електроніка',
  bio: '',
  avatarUrl: null,
  color: 'blue',
  email: 'andrii@test.ua',
  active: true,
  twoFactorEnabled: false,
  createdAt: '2026-09-01T10:00:00Z',
  pointsTotal: 12,
  ...over,
});

function usersApi(me: Me, target: UserDetail, extra: Record<string, (req: Request) => Response | Promise<Response>> = {}) {
  let current = target;
  return mockApi({
    'GET /api/auth/me': () => json(200, me),
    'GET /api/users': () =>
      json(200, {
        items: [person(), person({ id: 'u3', name: 'Оксана Блок', active: false }), person({ id: 'm2', name: 'Тарас Мод', role: 'moderator', twoFactorEnabled: true })],
        total: 3,
        page: 1,
        limit: 100,
      }),
    [`GET /api/users/${target.id}`]: () => json(200, current),
    [`PATCH /api/users/${target.id}`]: async (req) => {
      current = { ...current, ...((await req.json()) as Partial<UserDetail>) };
      return json(200, current);
    },
    'GET /api/place-authorizations': () => json(200, []),
    'GET /api/places': () => json(200, [{ id: 'p1', code: 'CNC-1', title: 'Фрезер', status: 'active' }]),
    ...extra,
  });
}

describe('Панель: учасники', () => {
  it('список: за замовчуванням активні, фільтр «Заблоковані», кнопка створення', async () => {
    usersApi(mod, person());
    renderApp('/panel/users');
    const list = await screen.findByRole('list', { name: 'Учасники' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).getByText('2FA')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Заблоковані' }));
    expect(within(list).getByRole('link')).toHaveTextContent('Оксана Блок');
    expect(screen.getByRole('link', { name: 'Новий учасник' })).toHaveAttribute('href', '/panel/users/new');
  });

  it('учаснику панель учасників закрита', async () => {
    usersApi(member, person());
    renderApp('/panel/users');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });

  it('створення з генерованим паролем; пароль показується один раз', async () => {
    const { calls } = usersApi(mod, person(), {
      'POST /api/users': async (req) => {
        const b = (await req.json()) as { name: string; email: string };
        return json(201, { ...member, id: 'u7', name: b.name, email: b.email });
      },
    });
    renderApp('/panel/users/new');
    await userEvent.type(await screen.findByLabelText('Ім’я'), 'Ліна Нова');
    await userEvent.type(screen.getByLabelText('Email'), 'lina@test.ua');
    const create = screen.getByRole('button', { name: 'Створити' });
    expect(create).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Згенерувати' }));
    const pwd = (screen.getByLabelText('Пароль') as HTMLInputElement).value;
    expect(pwd).toHaveLength(14);
    await userEvent.click(create);

    expect(await screen.findByRole('status')).toHaveTextContent(pwd);
    expect(screen.getByRole('link', { name: 'До учасника' })).toHaveAttribute('href', '/panel/users/u7');
    const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body) as Record<string, unknown>;
    expect(body).toEqual({ name: 'Ліна Нова', email: 'lina@test.ua', password: pwd });
  });
});

describe('Панель: керування учасником', () => {
  it('модератор над member: посада, підвищення й блокування з підтвердженням; без імені, пароля, 2FA', async () => {
    const { calls } = usersApi(mod, person());
    renderApp('/panel/users/u2');
    expect(await screen.findByLabelText('Посада')).toHaveValue('Інженер');
    expect(screen.queryByLabelText('Ім’я')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Біо')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Безпека' })).not.toBeInTheDocument();
    expect([...(screen.getByLabelText('Роль') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['member', 'moderator']);

    // Only the changed field is sent.
    await userEvent.clear(screen.getByLabelText('Посада'));
    await userEvent.type(screen.getByLabelText('Посада'), 'Технік');
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await screen.findByText('Збережено.');

    await userEvent.selectOptions(screen.getByLabelText('Роль'), 'moderator');
    await userEvent.click(screen.getByRole('button', { name: 'Змінити роль' }));
    await userEvent.click(within(screen.getByRole('group', { name: /Учасник → Модератор/ })).getByRole('button', { name: 'Так' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    const patches = calls.filter((c) => c.method === 'PATCH').map((c) => JSON.parse(c.body) as unknown);
    expect(patches).toEqual([{ position: 'Технік' }, { role: 'moderator' }]);
  });

  it('блокування: спершу питання, потім PATCH active=false', async () => {
    const { calls } = usersApi(mod, person());
    renderApp('/panel/users/u2');
    await userEvent.click(await screen.findByRole('button', { name: 'Заблокувати' }));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.click(within(screen.getByRole('group', { name: /Заблокувати Андрій/ })).getByRole('button', { name: 'Так' }));
    expect(await screen.findByRole('button', { name: 'Розблокувати' })).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ active: false });
  });

  it('модератор над іншим модератором: лише перегляд', async () => {
    usersApi(mod, person({ id: 'm2', role: 'moderator' }));
    renderApp('/panel/users/m2');
    expect(await screen.findByText(/Модератор не змінює дані інших модераторів/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Посада')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Заблокувати' })).not.toBeInTheDocument();
  });

  it('колір акаунта: адмін змінює чужий (іде лише колір), модератор — не бачить', async () => {
    const { calls } = usersApi(admin, person());
    renderApp('/panel/users/u2');
    const group = await screen.findByRole('group', { name: 'Колір акаунта' });
    expect(within(group).getByLabelText('Синій')).toBeChecked();
    await userEvent.click(within(group).getByLabelText('Помаранчевий'));
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await screen.findByText('Збережено.');
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ color: 'orange' });
  });

  it('модератор чужого кольору не змінює', async () => {
    usersApi(mod, person());
    renderApp('/panel/users/u2');
    await screen.findByLabelText('Посада');
    expect(screen.queryByRole('group', { name: 'Колір акаунта' })).not.toBeInTheDocument();
  });

  it('адмін: ім’я, роль адміна, скидання пароля і 2FA', async () => {
    const { calls } = usersApi(admin, person({ id: 'm2', role: 'moderator', twoFactorEnabled: true }), {
      'POST /api/users/m2/reset-password': () => json(201, { ok: true }),
      'POST /api/users/m2/2fa/reset': () => json(200, { ok: true }),
    });
    renderApp('/panel/users/m2');
    expect(await screen.findByLabelText('Ім’я')).toHaveValue('Андрій Шевчук');
    expect([...(screen.getByLabelText('Роль') as HTMLSelectElement).options].map((o) => o.value)).toContain('admin');

    const reset = screen.getByRole('button', { name: 'Скинути пароль' });
    expect(reset).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Новий пароль'), 'Secret-pass-1');
    await userEvent.click(reset);
    await userEvent.click(within(screen.getByRole('group', { name: /Скинути пароль/ })).getByRole('button', { name: 'Так' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Secret-pass-1');
    expect(JSON.parse(calls.find((c) => c.path.endsWith('reset-password'))!.body)).toEqual({ newPassword: 'Secret-pass-1' });

    await userEvent.click(screen.getByRole('button', { name: 'Скинути 2FA' }));
    await userEvent.click(within(screen.getByRole('group', { name: /Вимкнути вхід із кодом/ })).getByRole('button', { name: 'Так' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/users/m2/2fa/reset')).toBe(true));
  });

  const briefing: TemplateItem = {
    id: 'id1',
    title: 'Запис про інструктаж і допуск',
    kind: 'creates',
    target: 'place_authorization',
    numberPrefix: 'ІД',
    autoFreeze: true,
    creators: 'staff',
    visibility: 'author',
    archived: false,
    currentVersion: 1,
    draftVersion: null,
    needsUpdate: false,
    about: ['user', 'place'],
    createdAt: '2026-11-16T10:00:00Z',
    updatedAt: '2026-11-16T10:00:00Z',
  };
  const auth = {
    id: 'au1',
    user: { id: 'u2', name: 'Андрій Шевчук' },
    place: { id: 'p1', code: 'CNC-1', title: 'Фрезер' },
    grantedById: 'm1',
    grantedAt: '2026-10-01T10:00:00Z',
    expiresAt: null,
    expired: false,
    note: '',
    paper: null,
  };

  it('допуски учасника: «Видати допуск» — запис про інструктаж про цього учасника, одразу в редакторі', async () => {
    const { calls } = usersApi(mod, person(), {
      'GET /api/place-authorizations': () => json(200, [{ ...auth, id: 'au2', paper: { id: 'pp1', number: 'ІД-2026-001' } }]),
      'GET /api/papers/templates': () => json(200, [briefing]),
      'POST /api/papers': () => json(201, { id: 'pp2' }),
    });
    const { router } = renderApp('/panel/users/u2');
    const list = await screen.findByRole('list', { name: 'Видані допуски' });
    expect(list).toHaveTextContent('безстроково');
    // Granted by a document: revoked by cancelling it.
    expect(within(list).getByRole('link', { name: 'Запис ІД-2026-001' })).toHaveAttribute('href', '/editor/pp1');
    expect(within(list).queryByRole('button', { name: 'Відкликати' })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Видати допуск' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/pp2'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers' && c.method === 'POST')!.body)).toEqual({
      templateId: 'id1',
      about: { type: 'user', id: 'u2' },
    });
  });

  it('допуск, виданий до документів: відкликати або «Створити документ»', async () => {
    const { calls } = usersApi(mod, person(), {
      'GET /api/place-authorizations': () => json(200, [auth]),
      'GET /api/papers/templates': () => json(200, [briefing]),
      'DELETE /api/place-authorizations/au1': () => json(200, { ok: true }),
      'POST /api/papers/for-record': () => json(201, { id: 'pp3' }),
    });
    const { router } = renderApp('/panel/users/u2');
    const list = await screen.findByRole('list', { name: 'Видані допуски' });
    await userEvent.click(within(list).getByRole('button', { name: 'Відкликати' }));
    await userEvent.click(within(list).getByRole('button', { name: 'Так' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/au1'))).toBe(true));

    await userEvent.click(within(list).getByRole('button', { name: 'Створити документ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/pp3'));
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers/for-record')!.body)).toEqual({ templateId: 'id1', targetId: 'au1' });
  });

  it('у публічному профілі staff бачить «Керувати»', async () => {
    usersApi(mod, person());
    renderApp('/team/u2');
    expect(await screen.findByRole('link', { name: 'Керувати' })).toHaveAttribute('href', '/panel/users/u2');
  });
});
