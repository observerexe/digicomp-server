import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Doc, Me } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'documents.manage'] };
const doc = (over: Partial<Doc> = {}): Doc => ({
  id: 'd1', title: 'Паспорт фрезера', category: 'Паспорти', description: '', accessScope: 'members', placeId: null, inventoryItemId: null,
  authorId: 'm1', createdAt: '', updatedAt: '2026-11-01T10:00:00Z', archived: false, version: 2, fileName: 'pass.pdf', mimeType: 'application/pdf',
  size: 4_400_000, versionsCount: 2, ...over,
});
const base = (me: Me, extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/auth/me': () => json(200, me),
  'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
  'GET /api/documents': () => json(200, { items: [doc(), doc({ id: 'd2', title: 'Порядок дій', category: 'Інструкції', accessScope: 'supervisors', fileName: 'a.docx', mimeType: 'x' })], total: 2, page: 1, limit: 100 }),
  'GET /api/documents/d1/versions': () => json(200, [{ id: 'v2', version: 2, fileName: 'pass.pdf', mimeType: 'application/pdf', size: 10, sha256: '', changeNote: 'Нова схема', uploadedById: 'm1', createdAt: '' }]),
  'GET /api/places': () => json(200, []),
  'GET /api/inventory/items': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
  ...extra,
});

describe('Архів', () => {
  it('список: тип файлу, «лише модератори», категорії', async () => {
    mockApi(base(member));
    renderApp('/docs');
    const list = await screen.findByRole('list', { name: 'Документи' });
    expect(within(list).getByText('PDF')).toBeInTheDocument();
    expect(within(list).getByText('лише модератори')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Інструкції' }));
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Новий документ' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Показати архівні')).not.toBeInTheDocument();
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
    await userEvent.type(screen.getByLabelText('Категорія'), 'Інструкції');
    await userEvent.click(screen.getByLabelText('Лише модератори й адмін'));
    await userEvent.click(screen.getByRole('button', { name: 'Додати документ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/docs/n1'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    expect(post.body).toContain('supervisors');
    expect(post.body).toContain('Інструкції');
  });

  it('учаснику форма закрита', async () => {
    mockApi(base(member));
    renderApp('/docs/new');
    expect(await screen.findByRole('heading', { name: 'Немає доступу' })).toBeInTheDocument();
  });
});
