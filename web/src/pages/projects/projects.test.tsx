import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Me, ProjectDetail, ProjectListItem } from '../../api/types';
import { json, member, mockApi, moderator, renderApp } from '../../test/render';
import { historyText } from './ProjectPage';

const staff: Me = { ...moderator, permissions: [...moderator.permissions, 'projects.create', 'projects.manage'] };
const mem = (u: { id: string; name: string }) => ({ id: u.id, name: u.name, position: '', avatarUrl: null });
const project = (over: Partial<ProjectListItem> = {}): ProjectListItem => ({
  id: 'p1', title: 'Фестиваль', description: '', stage: 'planning', startDate: null, deadline: null, progress: 40,
  accomplishments: '', sources: [], createdById: null, createdAt: '', updatedAt: '', members: [], ...over,
});
const detail = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({ ...project(), files: [], canEdit: false, ...over });

function api(me: Me, list: ProjectListItem[], extra: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  return {
    'GET /api/auth/me': () => json(200, me),
    'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    'GET /api/projects': () => json(200, { items: list, total: list.length, page: 1, limit: 100 }),
    'GET /api/users': () => json(200, { items: [], total: 0, page: 1, limit: 100 }),
    ...extra,
  };
}

describe('Дошка проєктів', () => {
  it('учасник перетягує лише свій проєкт; етап змінюється одразу, при помилці повертається', async () => {
    const mine = project({ id: 'p1', title: 'Мій проєкт', members: [mem(member)] });
    const other = project({ id: 'p2', title: 'Чужий проєкт' });
    let release!: () => void;
    const { calls } = mockApi(
      api(member, [mine, other], {
        'PATCH /api/projects/p1': () =>
          new Promise<Response>((r) => {
            release = () => r(json(403, { errorCode: 'PROJECT_EDIT_FORBIDDEN' }));
          }),
      }),
    );
    renderApp('/projects');
    const col = await screen.findByRole('region', { name: 'Планування' });
    const card = (await within(col).findByText('Мій проєкт')).closest('article')!;
    expect(card).toHaveAttribute('draggable', 'true');
    expect(within(col).getByText('Чужий проєкт').closest('article')).toHaveAttribute('draggable', 'false');

    const dt = { setData: () => undefined, effectAllowed: '' };
    fireEvent.dragStart(card, { dataTransfer: dt });
    const exec = screen.getByRole('region', { name: 'Виконання' });
    fireEvent.dragOver(exec, { dataTransfer: dt });
    fireEvent.drop(exec, { dataTransfer: dt });
    expect(await within(exec).findByText('Мій проєкт')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ stage: 'execution' });
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent('Редагувати проєкт можуть лише його учасники');
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Планування' })).getByText('Мій проєкт')).toBeInTheDocument());
  });

  it('«Мої» шле memberId; «Новий проєкт» лише модератору', async () => {
    const queries: string[] = [];
    mockApi(
      api(member, [], {
        'GET /api/projects': (req) => {
          queries.push(new URL(req.url).search);
          return json(200, { items: [], total: 0, page: 1, limit: 100 });
        },
      }),
    );
    renderApp('/projects');
    await screen.findByRole('region', { name: 'Ідея' });
    expect(screen.queryByRole('link', { name: 'Новий проєкт' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Мої' }));
    await waitFor(() => expect(queries.some((q) => q.includes(`memberId=${member.id}`))).toBe(true));
  });
});

describe('Сторінка проєкту', () => {
  it('учасник змінює етап на місці; модератор бачить архів', async () => {
    const { calls } = mockApi(
      api(staff, [], {
        'GET /api/projects/p1': () => json(200, detail({ canEdit: true, sources: ['https://example.com/brief', 'папка на диску'] })),
        'GET /api/projects/p1/history': () =>
          json(200, [{ id: 'h1', action: 'project.updated', actor: { id: 'm1', name: 'Олег' }, meta: { fields: ['stage', 'progress'] }, createdAt: '2026-11-01T10:00:00Z' }]),
        'PATCH /api/projects/p1': () => json(200, detail({ canEdit: true, stage: 'review' })),
        'DELETE /api/projects/p1': () => json(200, { ok: true }),
      }),
    );
    const { router } = renderApp('/projects/p1');
    expect(await screen.findByRole('link', { name: 'https://example.com/brief' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('папка на диску').tagName).toBe('SPAN');
    expect(await screen.findByText('Олег змінив(-ла) етап, прогрес')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Етап'), 'review');
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ stage: 'review' });
    await userEvent.click(screen.getByRole('button', { name: 'В архів' }));
    await userEvent.click(screen.getByRole('button', { name: 'Так, в архів' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
  });

  it('без права редагування — без керування', async () => {
    mockApi(api(member, [], { 'GET /api/projects/p1': () => json(200, detail()), 'GET /api/projects/p1/history': () => json(200, []) }));
    renderApp('/projects/p1');
    await screen.findByRole('heading', { name: 'Фестиваль' });
    expect(screen.queryByLabelText('Етап')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Редагувати' })).not.toBeInTheDocument();
  });

  it('тексти історії', () => {
    const h = (action: string, meta: Record<string, unknown> | null = null) => ({ id: 'h', action, actor: { id: 'u', name: 'Ірина' }, meta, createdAt: '' });
    expect(historyText(h('project.created'))).toBe('Ірина створив(-ла) проєкт');
    expect(historyText(h('project.file_added'))).toBe('Ірина додав(-ла) файл');
    expect(historyText(h('project.updated', { fields: ['memberIds'] }))).toBe('Ірина змінив(-ла) учасників');
  });
});

describe('Форма проєкту', () => {
  it('дати перевіряються; учасник не бачить вибору учасників і не шле memberIds', async () => {
    const { calls } = mockApi(
      api(member, [], {
        'GET /api/projects/p1': () => json(200, detail({ canEdit: true, members: [mem(member)] })),
        'PATCH /api/projects/p1': () => json(200, detail({ canEdit: true })),
        'GET /api/projects/p1/history': () => json(200, []),
      }),
    );
    renderApp('/projects/p1/edit');
    await screen.findByLabelText('Назва');
    expect(screen.queryByRole('group', { name: 'Учасники' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Початок'), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText('Дедлайн'), { target: { value: '2026-12-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Дедлайн не може бути раніше дати початку.');
    fireEvent.change(screen.getByLabelText('Дедлайн'), { target: { value: '2026-12-20' } });
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const body = JSON.parse(calls.find((c) => c.method === 'PATCH')!.body) as Record<string, unknown>;
    expect(body).toMatchObject({ startDate: '2026-12-10', deadline: '2026-12-20' });
    expect(body).not.toHaveProperty('memberIds');
  });
});
