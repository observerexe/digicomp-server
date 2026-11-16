import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ArchiveItem, Doc, Me } from '../../api/types';
import { dictionary, json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'documents.manage'] };
const doc = (over: Partial<Doc> = {}): Doc => ({
  id: 'd1', title: 'Паспорт фрезера', category: 'pasporty', description: '', accessScope: 'members',
  authorId: 'm1', createdAt: '', updatedAt: '2026-11-01T10:00:00Z', archived: false, version: 2, fileName: 'pass.pdf', mimeType: 'application/pdf',
  size: 4_400_000, versionsCount: 2, ...over,
});
const fileItem = (over: Partial<ArchiveItem> = {}, file: Partial<NonNullable<ArchiveItem['file']>> = {}): ArchiveItem => ({
  kind: 'file', id: 'd1', title: 'Паспорт фрезера', updatedAt: '2026-11-01T10:00:00Z', paper: null,
  file: { category: 'pasporty', accessScope: 'members', archived: false, version: 2, fileName: 'pass.pdf', size: 4_400_000, ...file },
  ...over,
});
const paperItem = (paper: Partial<NonNullable<ArchiveItem['paper']>> = {}): ArchiveItem => ({
  kind: 'paper', id: 'p1', title: 'Створення сайту', updatedAt: '2026-11-02T10:00:00Z', file: null,
  paper: { number: 'ТЗ-2026-014', status: 'signed', template: 'Технічне завдання', author: { id: 'm1', name: 'Олена Коваль', avatarUrl: null }, ...paper },
});
const archive = (items: ArchiveItem[], over: { years?: number[]; categories?: string[]; total?: number } = {}) => ({
  items, total: over.total ?? items.length, page: 1, limit: 100, years: over.years ?? [2026, 2025], categories: over.categories ?? ['pasporty', 'instruktsii'],
});
const base = (me: Me, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/auth/me': () => json(200, me),
  ...dictionary('document_category', [
    { key: 'instruktsii', title: 'Інструкції' },
    { key: 'pasporty', title: 'Паспорти' },
  ]),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/archive': () => json(200, archive([fileItem(), fileItem({ id: 'd2', title: 'Порядок дій' }, { category: 'instruktsii', accessScope: 'supervisors', fileName: 'a.docx' }), paperItem()])),
  'GET /api/links': () => json(200, { canLink: false, items: [] }),
  'GET /api/documents/d1/versions': () => json(200, [{ id: 'v2', version: 2, fileName: 'pass.pdf', mimeType: 'application/pdf', size: 10, sha256: '', changeNote: 'Нова схема', uploadedById: 'm1', createdAt: '' }]),
  ...extra,
});

describe('Архів', () => {
  it('список: файли й документи редактора разом; тип файлу, «лише модератори», стан документа', async () => {
    mockApi(base(member));
    renderApp('/docs');
    const list = await screen.findByRole('list', { name: 'Архів' });
    expect(within(list).getByText('PDF')).toBeInTheDocument();
    expect(within(list).getByText('лише модератори')).toBeInTheDocument();
    // Category by its title from the dictionary.
    expect(await within(list).findByText(/^Паспорти · версія 2/)).toBeInTheDocument();
    const paper = within(list).getByRole('link', { name: /ТЗ-2026-014 Створення сайту/ });
    expect(paper).toHaveAttribute('href', '/editor/p1');
    expect(within(paper).getByText('Підписано')).toBeInTheDocument();
    expect(within(paper).getByText(/^Технічне завдання · Олена Коваль · оновлено/)).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: /Паспорт фрезера/ })).toHaveAttribute('href', '/docs/d1');
    expect(screen.queryByRole('link', { name: 'Новий документ' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Показати архівні файли')).not.toBeInTheDocument();
  });

  it('фільтри йдуть на сервер; стан — лише для документів, категорія — лише для файлів', async () => {
    const { calls } = mockApi(base(member));
    renderApp('/docs');
    await screen.findByRole('list', { name: 'Архів' });
    const last = () => new URL(calls.filter((c) => c.path === '/api/archive').at(-1)!.url).searchParams;

    await userEvent.click(within(screen.getByRole('group', { name: 'Рік' })).getByRole('button', { name: '2025' }));
    await waitFor(() => expect(last().get('year')).toBe('2025'));
    await userEvent.click(within(screen.getByRole('group', { name: 'Категорія' })).getByRole('button', { name: 'Інструкції' }));
    await waitFor(() => expect(last().get('category')).toBe('instruktsii'));

    // «Документи» hides the categories and drops the chosen one.
    await userEvent.click(within(screen.getByRole('group', { name: 'Вид' })).getByRole('button', { name: 'Документи' }));
    await waitFor(() => expect(last().get('kind')).toBe('paper'));
    expect(last().get('category')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Категорія' })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('group', { name: 'Стан' })).getByRole('button', { name: 'Зафіксовано' }));
    await waitFor(() => expect(last().get('status')).toBe('frozen'));

    // «Файли» hides the states and drops the chosen one.
    await userEvent.click(within(screen.getByRole('group', { name: 'Вид' })).getByRole('button', { name: 'Файли' }));
    await waitFor(() => expect(last().get('kind')).toBe('file'));
    expect(last().get('status')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Стан' })).not.toBeInTheDocument();
    expect(last().get('year')).toBe('2025');
  });

  it('модератор: архівні файли — без виду й стану', async () => {
    const { calls } = mockApi(base(staff));
    renderApp('/docs');
    await screen.findByRole('list', { name: 'Архів' });
    await userEvent.click(screen.getByLabelText('Показати архівні файли'));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/archive' && new URL(c.url).searchParams.get('archived') === 'true')).toBe(true));
    expect(screen.queryByRole('group', { name: 'Вид' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Стан' })).not.toBeInTheDocument();
  });

  it('порожньо: без фільтрів — «нічого немає», з пошуком — «нічого не знайдено»', async () => {
    mockApi(base(member, { 'GET /api/archive': () => json(200, archive([], { years: [], categories: [] })) }));
    renderApp('/docs');
    expect(await screen.findByText('В Архіві ще нічого немає.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'наказ');
    expect(await screen.findByText('Нічого не знайдено.')).toBeInTheDocument();
  });

  it('PDF показується у вбудованому вікні через ?inline=1; учасник без керування', async () => {
    mockApi(base(member, { 'GET /api/documents/d1': () => json(200, doc()) }));
    renderApp('/docs/d1');
    const frame = await screen.findByTitle('Перегляд: Паспорт фрезера');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', '/api/documents/d1/download?inline=1');
    expect(await screen.findByText(/Нова схема/)).toBeInTheDocument();
    expect(screen.queryByText('Нова версія')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Редагувати' })).not.toBeInTheDocument();
  });

  it('картинка — <img>, текст — <pre>, docx — лише завантаження', async () => {
    mockApi(
      base(member, {
        'GET /api/documents/d1': () => json(200, doc({ mimeType: 'image/png', fileName: 'scheme.png' })),
        'GET /api/documents/d3': () => json(200, doc({ id: 'd3', mimeType: 'text/plain; charset=utf-8', fileName: 'notes.txt' })),
        'GET /api/documents/d3/versions': () => json(200, []),
        'GET /api/documents/d3/download': () => new Response('рядок 1\nрядок 2', { status: 200 }),
        'GET /api/documents/d4': () => json(200, doc({ id: 'd4', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'a.docx' })),
        'GET /api/documents/d4/versions': () => json(200, []),
      }),
    );
    const { router } = renderApp('/docs/d1');
    expect(await screen.findByRole('img', { name: 'Паспорт фрезера' })).toHaveAttribute('src', '/api/documents/d1/download');
    await router.navigate('/docs/d3');
    expect(await screen.findByText(/рядок 1/)).toBeInTheDocument();
    await router.navigate('/docs/d4');
    expect(await screen.findByText(/Перегляд для DOCX у застосунку недоступний/)).toBeInTheDocument();
  });

  it('новий документ: файл перетягуванням, назва з імені файлу, доступ «лише модератори»', async () => {
    const { calls } = mockApi(
      base(staff, { 'POST /api/documents': () => json(201, doc({ id: 'n1' })), 'GET /api/documents/n1': () => json(200, doc({ id: 'n1' })), 'GET /api/documents/n1/versions': () => json(200, []) }),
    );
    const { router } = renderApp('/docs/new');
    const zone = await screen.findByTestId('dropzone');
    const file = new File(['%PDF-1.4'], 'Інструкція з безпеки.pdf', { type: 'application/pdf' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(within(zone).getByText(/Інструкція з безпеки.pdf/)).toBeInTheDocument();
    expect(screen.getByLabelText('Назва')).toHaveValue('Інструкція з безпеки');
    const select = screen.getByLabelText('Категорія');
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, 'Інструкції');
    await userEvent.click(screen.getByLabelText('Лише модератори й адмін'));
    await userEvent.click(screen.getByRole('button', { name: 'Додати документ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs/n1'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    expect(post.body).toContain('supervisors');
    expect(post.body).toMatch(/name="category"\r\n\r\ninstruktsii\r\n/);
  });

  it('новий документ пов’язується з вибраними записами після завантаження', async () => {
    const { calls } = mockApi(
      base(staff, {
        'POST /api/documents': () => json(201, doc({ id: 'n1' })),
        'GET /api/documents/n1': () => json(200, doc({ id: 'n1' })),
        'GET /api/documents/n1/versions': () => json(200, []),
        'GET /api/links/candidates': (req) =>
          json(200, new URL(req.url).searchParams.get('type') === 'place' ? [{ id: 'p1', type: 'place', title: 'Фрезер', archived: false, code: 'CNC-1' }] : []),
        'POST /api/links': () => json(201, {}),
      }),
    );
    const { router } = renderApp('/docs/new');
    fireEvent.drop(await screen.findByTestId('dropzone'), { dataTransfer: { files: [new File(['x'], 'Паспорт.pdf', { type: 'application/pdf' })] } });
    const select = screen.getByLabelText('Категорія');
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, 'Паспорти');

    await userEvent.click(screen.getByRole('button', { name: 'Вибрати запис' }));
    await userEvent.click(screen.getByRole('button', { name: 'Обладнання' }));
    // Enter in the search does not submit the form.
    await userEvent.type(screen.getByRole('searchbox'), 'cnc{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /Фрезер/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(within(screen.getByRole('list', { name: 'Вибрані записи' })).getByText('Обладнання: Фрезер')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Додати документ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs/n1'));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/links')!;
    expect(JSON.parse(post.body)).toEqual({ fromType: 'document', fromId: 'n1', toType: 'place', toId: 'p1' });
  });

  it('учаснику форма закрита', async () => {
    mockApi(base(member));
    renderApp('/docs/new');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
