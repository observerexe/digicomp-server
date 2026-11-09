import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { safeNext } from './pages/LoginPage';
import { json, member, mockApi, moderator, renderApp } from './test/render';

const loggedOut = {
  'GET /api/auth/me': () => json(401, { errorCode: 'UNAUTHORIZED' }),
  'POST /api/auth/refresh': () => json(401, { errorCode: 'INVALID_REFRESH_TOKEN' }),
};

describe('Вхід', () => {
  it('без сесії відправляє на вхід і повертає на потрібну сторінку', async () => {
    let user: unknown = null;
    mockApi({
      'GET /api/auth/me': () => (user ? json(200, user) : json(401, {})),
      'POST /api/auth/refresh': () => json(401, {}),
      'POST /api/auth/login': async (req) => {
        const body = (await req.json()) as { email: string };
        expect(body.email).toBe('marta@test');
        user = member;
        return json(200, { user: member });
      },
    });
    const { router } = renderApp('/tasks');
    await screen.findByRole('button', { name: 'Увійти' });
    expect(router.state.location.pathname).toBe('/login');

    await userEvent.type(screen.getByLabelText('Email'), ' marta@test ');
    await userEvent.type(screen.getByLabelText('Пароль'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Увійти' }));

    await screen.findByRole('heading', { name: 'ТЗ' });
    expect(router.state.location.pathname).toBe('/tasks');
  });

  it('неправильний пароль — людський текст за кодом', async () => {
    mockApi({ ...loggedOut, 'POST /api/auth/login': () => json(401, { errorCode: 'INVALID_CREDENTIALS' }) });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.c');
    await userEvent.type(screen.getByLabelText('Пароль'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Неправильний email або пароль.');
  });

  it('2FA: другий крок з кодом, потім застосунок', async () => {
    const { calls } = mockApi({
      ...loggedOut,
      'POST /api/auth/login': () => json(200, { twoFactorRequired: true, challengeToken: 'ch-1' }),
      'POST /api/auth/2fa/verify': () => json(200, { user: member }),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'marta@test');
    await userEvent.type(screen.getByLabelText('Пароль'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Увійти' }));

    await userEvent.type(await screen.findByLabelText('Код'), '123 456');
    await userEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));
    await screen.findByRole('heading', { name: 'Добрий день, Марта' });
    const verify = calls.find((c) => c.path === '/api/auth/2fa/verify')!;
    expect(JSON.parse(verify.body)).toEqual({ challengeToken: 'ch-1', code: '123456' });
  });

  it('2FA: запасний код і застарілий виклик повертає до пароля', async () => {
    const { calls } = mockApi({
      ...loggedOut,
      'POST /api/auth/login': () => json(200, { twoFactorRequired: true, challengeToken: 'ch-1' }),
      'POST /api/auth/2fa/verify': () => json(401, { errorCode: 'TWO_FACTOR_CHALLENGE_INVALID' }),
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'marta@test');
    await userEvent.type(screen.getByLabelText('Пароль'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    await userEvent.click(await screen.findByRole('button', { name: /Запасний код/ }));
    await userEvent.type(screen.getByLabelText('Запасний код'), '7kq2-m9xd');
    await userEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Час на введення коду минув');
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    const verify = calls.find((c) => c.path === '/api/auth/2fa/verify')!;
    expect(JSON.parse(verify.body)).toEqual({ challengeToken: 'ch-1', recoveryCode: '7kq2-m9xd' });
  });

  it('після входу не переходить на чужий сайт (next)', () => {
    expect(safeNext('/tasks?x=1')).toBe('/tasks?x=1');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('/api/auth/logout')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('Навігація за правами', () => {
  it('учасник не бачить «Керування», а /panel показує «Немає доступу»', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, member) });
    renderApp('/panel');
    await screen.findByRole('heading', { name: 'Немає доступу' });
    expect(screen.queryByRole('navigation', { name: 'Керування' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Панель керування/ })).not.toBeInTheDocument();
  });

  it('модератор бачить панель керування', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, moderator) });
    renderApp('/panel');
    await screen.findByRole('heading', { name: 'Панель керування' });
    expect(screen.getByRole('navigation', { name: 'Керування' })).toBeInTheDocument();
  });

  it('нижня панель: 4 вкладки і кнопка QR посередині', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, member) });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Добрий день, Марта' });
    const bars = screen.getAllByRole('navigation', { name: 'Основна навігація' });
    const tabbar = bars[bars.length - 1]!;
    const names = [...tabbar.querySelectorAll('a')].map((a) => a.getAttribute('aria-label') ?? a.textContent);
    expect(names).toEqual(['Головна', 'ТЗ', 'Сканувати QR', 'Лабораторія', 'Профіль']);
  });

  it('невідома сторінка — «Сторінку не знайдено»', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, member) });
    renderApp('/no-such-page');
    await screen.findByRole('heading', { name: 'Сторінку не знайдено' });
  });
});

describe('Тема і вихід', () => {
  it('тема зберігається на пристрої, «як у системі» скидає вибір', async () => {
    mockApi({ 'GET /api/auth/me': () => json(200, member) });
    renderApp('/more');
    await userEvent.click(await screen.findByLabelText('Темна'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('dc-theme')).toBe('dark');
    await userEvent.click(screen.getByLabelText('Як у системі'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('dc-theme')).toBeNull();
  });

  it('вихід очищує дані й веде на вхід', async () => {
    let session = true;
    const { calls } = mockApi({
      'GET /api/auth/me': () => (session ? json(200, member) : json(401, {})),
      'POST /api/auth/refresh': () => json(401, {}),
      'POST /api/auth/logout': () => {
        session = false;
        return json(200, { ok: true });
      },
    });
    const { router } = renderApp('/more');
    await userEvent.click(await screen.findByRole('button', { name: 'Вийти' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
  });
});
