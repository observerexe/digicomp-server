import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const MONTH = new Intl.DateTimeFormat('uk-UA', { month: 'long', timeZone: 'Europe/Kyiv' }).format(new Date());

const profileApi = (me: Me) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/points/me': () =>
    json(200, {
      balance: 340,
      history: [
        {
          id: 'p1',
          kind: 'task',
          amount: 30,
          reason: '',
          taskId: 't1',
          taskTitle: 'Монтаж ролика',
          reversesId: null,
          createdBy: null,
          revoked: false,
          createdAt: '2026-11-05T10:00:00Z',
        },
        {
          id: 'p2',
          kind: 'manual',
          amount: 10,
          reason: 'Чергування',
          taskId: null,
          taskTitle: null,
          reversesId: null,
          createdBy: { id: 'm1', name: 'Олег Петренко' },
          revoked: true,
          createdAt: '2026-11-01T10:00:00Z',
        },
        {
          id: 'p3',
          kind: 'reversal',
          amount: -10,
          reason: 'Нараховано двічі',
          taskId: null,
          taskTitle: null,
          reversesId: 'p2',
          createdBy: { id: 'm1', name: 'Олег Петренко' },
          revoked: false,
          createdAt: '2026-11-02T10:00:00Z',
        },
      ],
    }),
  'GET /api/points/leaderboard': (req: Request) => {
    const month = new URL(req.url).searchParams.get('period') === 'month';
    return json(200, [{ id: me.id, name: me.name, avatarUrl: null, position: '', total: 340, rank: month ? 4 : 9 }]);
  },
  'GET /api/discipline/me': () =>
    json(200, [
      {
        id: 'd1',
        type: 'fine',
        amount: 15,
        reason: 'Не повернула камеру на склад.',
        user: null,
        issuedBy: { id: 'm1', name: 'Олег Петренко', avatarUrl: null },
        createdAt: '2026-09-18T10:00:00Z',
        revoked: true,
        revokedAt: '2026-09-20T10:00:00Z',
        revokedBy: null,
        revokeReason: 'Камеру знайшли в кейсі.',
      },
    ]),
  'GET /api/tasks': () =>
    json(200, [
      { id: 't1', title: 'Монтаж ролика', status: 'in_progress', dueDate: null, assignees: [] },
      { id: 't2', title: 'Старе ТЗ', status: 'done', dueDate: null, assignees: [] },
    ]),
  'GET /api/projects': () => json(200, { items: [{ id: 'pr1', title: 'Фестиваль', stage: 'execution', deadline: null }], total: 1, page: 1, limit: 100 }),
  'GET /api/place-authorizations': () =>
    json(200, [
      { id: 'a1', place: { id: 'pl1', code: 'CNC-1', title: 'Фрезер' }, expiresAt: null, expired: false },
      { id: 'a2', place: { id: 'pl2', code: 'LAS-1', title: 'Лазер' }, expiresAt: null, expired: true },
    ]),
  'GET /api/bookings/me': () => json(200, []),
});

describe('Мій профіль', () => {
  it('баланс, місця, історія, дисципліна, моє', async () => {
    mockApi(profileApi(member));
    renderApp('/profile');
    expect(await screen.findByText('340')).toBeInTheDocument();
    expect(await screen.findByText(`4 місце за ${MONTH} · 9 за весь час`)).toBeInTheDocument();

    const history = screen.getByRole('list', { name: 'Історія балів' });
    expect(within(history).getByText('ТЗ «Монтаж ролика»')).toBeInTheDocument();
    expect(within(history).getByText(/Система/)).toBeInTheDocument();
    // The revoked entry and its reversal are one crossed-out row with the reason.
    expect(within(history).getByText(/Олег Петренко · знято: Нараховано двічі/)).toBeInTheDocument();
    expect(within(history).getAllByRole('listitem')).toHaveLength(2);
    expect(within(history).queryByText('−10')).not.toBeInTheDocument();

    expect(screen.getByText('бачите лише ви')).toBeInTheDocument();
    const records = await screen.findByRole('list', { name: 'Попередження й штрафи' });
    expect(within(records).getByText('Штраф −15')).toBeInTheDocument();
    expect(within(records).getByText(/знято/)).toBeInTheDocument();
    expect(within(records).getByText('Знято: Камеру знайшли в кейсі.')).toBeInTheDocument();
    expect(within(records).getByText('Видав Олег Петренко')).toBeInTheDocument();

    // Done tasks and expired authorizations are not counted.
    expect(await screen.findByText('1 активне')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Допуски'));
    expect(screen.getByRole('link', { name: /Фрезер/ })).toHaveAttribute('href', '/lab/CNC-1');
    expect(screen.getByRole('link', { name: /Лазер/ })).toHaveTextContent('термін минув');

    expect(screen.getByRole('link', { name: 'Увімкнути 2FA' })).toHaveAttribute('href', '/profile/2fa');
  });

  it('адмін без 2FA бачить, що панель потребує коду', async () => {
    mockApi(profileApi({ ...member, role: 'admin' }));
    renderApp('/profile');
    expect(await screen.findByText(/Розширена панель відкривається лише/)).toBeInTheDocument();
  });
});

describe('Біо й аватар', () => {
  it('member: ім’я, посада, спеціальність недоступні; зберігається лише біо', async () => {
    const { calls } = mockApi({
      ...profileApi(member),
      'PATCH /api/users/me': async (req) => json(200, { ...member, ...(await req.json()) }),
    });
    renderApp('/profile/edit');
    expect(await screen.findByLabelText('Ім’я')).toBeDisabled();
    expect(screen.getByLabelText('Посада')).toBeDisabled();
    expect(screen.getByLabelText('Спеціальність')).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Біо'), 'Знімаю репортажі.');
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await screen.findByRole('heading', { name: 'Профіль' });
    expect(screen.getByText('Знімаю репортажі.')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patch.body)).toEqual({ bio: 'Знімаю репортажі.' });
  });

  it('moderator змінює посаду, але не ім’я', async () => {
    const { calls } = mockApi({
      ...profileApi(moderator),
      'PATCH /api/users/me': async (req) => json(200, { ...moderator, ...(await req.json()) }),
    });
    renderApp('/profile/edit');
    expect(await screen.findByLabelText('Ім’я')).toBeDisabled();
    const position = screen.getByLabelText('Посада');
    expect(position).toBeEnabled();
    await userEvent.clear(position);
    await userEvent.type(position, 'Керівник групи ');
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await screen.findByRole('heading', { name: 'Профіль' });
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ position: 'Керівник групи' });
  });

  it('аватар: файл іде multipart, новий аватар видно одразу', async () => {
    const { calls } = mockApi({
      ...profileApi(member),
      [`POST /api/users/${member.id}/avatar`]: () => json(201, { avatarUrl: `/api/files/avatars/${member.id}?v=1` }),
    });
    renderApp('/profile/edit');
    await screen.findByRole('button', { name: 'Додати фото' });
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' });
    await userEvent.upload(document.getElementById('avatar-file') as HTMLInputElement, file);
    await screen.findByRole('button', { name: 'Змінити фото' });
    const up = calls.find((c) => c.method === 'POST')!;
    expect(up.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    expect(up.headers.get('x-dc-client')).toBe('web');
    expect(document.querySelector(`img[src="/api/files/avatars/${member.id}?v=1"]`)).not.toBeNull();
  });

  it('аватар: помилка сервера — текст за кодом', async () => {
    mockApi({
      ...profileApi(member),
      [`POST /api/users/${member.id}/avatar`]: () => json(400, { errorCode: 'FILE_CONTENT_MISMATCH' }),
    });
    renderApp('/profile/edit');
    await screen.findByRole('button', { name: 'Додати фото' });
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    await userEvent.upload(document.getElementById('avatar-file') as HTMLInputElement, file);
    expect(await screen.findByRole('alert')).toHaveTextContent('розширення не відповідає вмісту');
  });
});

describe('Зміна пароля', () => {
  const fill = async (current: string, next: string, repeat: string) => {
    await userEvent.type(await screen.findByLabelText('Поточний пароль'), current);
    await userEvent.type(screen.getByLabelText('Новий пароль'), next);
    await userEvent.type(screen.getByLabelText('Повторіть новий пароль'), repeat);
    await userEvent.click(screen.getByRole('button', { name: 'Змінити пароль' }));
  };

  it('паролі не збігаються — без запиту', async () => {
    const { calls } = mockApi(profileApi(member));
    renderApp('/profile/password');
    await fill('old-password', 'new-password-1', 'new-password-2');
    expect(screen.getByRole('alert')).toHaveTextContent('Паролі не збігаються.');
    expect(calls.some((c) => c.path === '/api/users/me/password')).toBe(false);
  });

  it('неправильний поточний пароль', async () => {
    mockApi({ ...profileApi(member), 'PATCH /api/users/me/password': () => json(400, { errorCode: 'INVALID_CURRENT_PASSWORD' }) });
    renderApp('/profile/password');
    await fill('wrong-pass', 'new-password-1', 'new-password-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Поточний пароль введено неправильно.');
  });

  it('успіх: вихід і пояснення на екрані входу', async () => {
    const { calls } = mockApi({
      ...profileApi(member),
      'PATCH /api/users/me/password': () => json(200, { ok: true }),
      'POST /api/auth/logout': () => json(200, { ok: true }),
      'POST /api/auth/refresh': () => json(401, {}),
    });
    const { router } = renderApp('/profile/password');
    await fill('old-password', 'new-password-1', 'new-password-1');
    expect(await screen.findByRole('status')).toHaveTextContent('Пароль змінено');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/profile');
    expect(JSON.parse(calls.find((c) => c.path === '/api/users/me/password')!.body)).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password-1',
    });
    expect(calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
  });
});

describe('Вхід із кодом (2FA)', () => {
  it('увімкнення: QR, ключ, код, запасні коди, вхід знову', async () => {
    const { calls } = mockApi({
      ...profileApi(member),
      'POST /api/auth/2fa/setup': () =>
        json(200, { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/DigiComp%20HUB:marta@test?secret=JBSWY3DPEHPK3PXP' }),
      'POST /api/auth/2fa/enable': () => json(200, { recoveryCodes: ['7kq2-m9xd', 'p4ab-zz81'] }),
      'POST /api/auth/logout': () => json(200, { ok: true }),
    });
    const { router } = renderApp('/profile/2fa');
    await userEvent.click(await screen.findByRole('button', { name: 'Почати налаштування' }));
    expect(await screen.findByRole('img', { name: /QR-код/ })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();

    const enable = screen.getByRole('button', { name: 'Увімкнути' });
    expect(enable).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Код із застосунку'), '123 456');
    await userEvent.click(enable);

    const codes = await screen.findByRole('list', { name: 'Запасні коди' });
    expect(within(codes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['7kq2-m9xd', 'p4ab-zz81']);
    expect(screen.getByRole('link', { name: 'Завантажити .txt' })).toHaveAttribute('download', 'digicomp-recovery-codes.txt');
    expect(JSON.parse(calls.find((c) => c.path === '/api/auth/2fa/enable')!.body)).toEqual({ code: '123456' });

    const again = screen.getByRole('button', { name: 'Увійти знову' });
    expect(again).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Коди збережено в надійному місці'));
    await userEvent.click(again);
    expect(await screen.findByRole('status')).toHaveTextContent('Вхід із кодом увімкнено');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/profile');
  });

  it('сервер без ключа 2FA — зрозумілий текст', async () => {
    mockApi({ ...profileApi(member), 'POST /api/auth/2fa/setup': () => json(503, { errorCode: 'TWO_FACTOR_NOT_CONFIGURED' }) });
    renderApp('/profile/2fa');
    await userEvent.click(await screen.findByRole('button', { name: 'Почати налаштування' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ще не налаштований на сервері');
  });

  it('увімкнено: нові запасні коди і вимкнення запасним кодом', async () => {
    const me = { ...member, twoFactorEnabled: true };
    const { calls } = mockApi({
      ...profileApi(me),
      'POST /api/auth/2fa/recovery-codes': () => json(200, { recoveryCodes: ['aaaa-bbbb'] }),
      'POST /api/auth/2fa/disable': async (req) => {
        const body = (await req.json()) as { recoveryCode?: string };
        return body.recoveryCode === 'good-code' ? json(200, { ok: true }) : json(403, { errorCode: 'TWO_FACTOR_INVALID_CODE' });
      },
    });
    renderApp('/profile/2fa');
    await userEvent.type(await screen.findByLabelText('Код із застосунку', { selector: '#rc-code' }), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Отримати нові коди' }));
    expect(await screen.findByText('aaaa-bbbb')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Немає телефона? Запасний код' }));
    await userEvent.type(screen.getByLabelText('Запасний код'), 'bad-code');
    await userEvent.click(screen.getByRole('button', { name: 'Вимкнути' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Код не підходить');

    await userEvent.clear(screen.getByLabelText('Запасний код'));
    await userEvent.type(screen.getByLabelText('Запасний код'), 'good-code');
    await userEvent.click(screen.getByRole('button', { name: 'Вимкнути' }));
    expect(await screen.findByRole('button', { name: 'Почати налаштування' })).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/auth/2fa/disable')).toHaveLength(2));
  });
});
