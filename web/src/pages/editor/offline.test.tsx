import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me, Paper } from '../../api/types';
import { claimDraft, draftKey, dropDrafts, putDraft, releaseDraft, type DraftTarget, type LocalDraft } from '../../lib/localDrafts';
import { json, member, mockApi, renderApp } from '../../test/render';

// The background sending is tested apart (editor/offline.test.tsx): here the editor alone meets the kept changes.
vi.mock('../../lib/localDrafts', async (orig) => ({ ...(await orig<typeof import('../../lib/localDrafts')>()), sendDrafts: () => Promise.resolve() }));

const P1: DraftTarget = { kind: 'paper', id: 'p1' };
const KEY = draftKey('u1', P1);
const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const draft = (over: Partial<LocalDraft> = {}): LocalDraft => ({
  key: KEY,
  userId: 'u1',
  target: P1,
  revision: 1,
  change: { title: 'Мій протокол' },
  at: '2026-11-16T09:00:00Z',
  ...over,
});
/** What the device keeps for the document (read the way an editor does). */
const stored = async () => {
  const d = await claimDraft(KEY);
  releaseDraft(KEY);
  return d;
};

afterEach(() => dropDrafts());

describe('Чернетка на пристрої: відкриття документа', () => {
  const writer: Me = { ...member, permissions: [...member.permissions, 'papers.read', 'papers.create', 'papers.edit'] };
  const paper = (over: Partial<Paper> = {}): Paper => ({
    id: 'p1',
    title: 'Протокол зборів',
    status: 'draft',
    visibility: 'author',
    author: { id: 'u1', name: 'Марта Коваль', avatarUrl: null },
    revision: 1,
    createdAt: '2026-11-14T10:00:00Z',
    updatedAt: '2026-11-14T10:00:00Z',
    content: text('Порядок денний'),
    values: {},
    template: null,
    refs: [],
    canEdit: true,
    number: null,
    publishedAt: null,
    targetType: null,
    targetId: null,
    cancelReason: null,
    canPublish: false,
    canCancel: false,
    canChange: false,
    canFreeze: false,
    canSign: false,
    snapshot: null,
    snapshots: [],
    tables: {},
    ...over,
  });
  const base = (extra: Record<string, (r: Request) => Response | Promise<Response>>) => ({
    'GET /api/auth/me': () => json(200, writer),
    'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
    ...extra,
  });
  const { title: _t, content: _c, canEdit: _e, values: _v, template: _tp, refs: _r, ...item } = paper();

  it('та сама revision — зміни відновлюються в редакторі й одразу надсилаються', async () => {
    await putDraft(draft({ change: { title: 'Мій протокол', content: text('Мій текст') } }));
    const { calls } = mockApi(
      base({
        'GET /api/papers/p1': () => json(200, paper()),
        'PATCH /api/papers/p1': () => json(200, { ...item, title: 'Мій протокол', revision: 2, updatedAt: '2026-11-16T10:00:00Z' }),
      }),
    );
    renderApp('/editor/p1');
    expect(await screen.findByLabelText('Текст документа')).toHaveTextContent('Мій текст');
    expect(screen.getByLabelText('Назва документа')).toHaveValue('Мій протокол');
    expect(screen.getByText('Відновлено зміни з цього пристрою, які минулого разу не дійшли на сервер.')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body)).toEqual({ revision: 1, title: 'Мій протокол', content: text('Мій текст') });
    expect(await screen.findByText(/^Збережено о /)).toBeInTheDocument();
    await waitFor(async () => expect(await stored()).toBeNull());
  });

  it('сервер уже має ці зміни — просто відкривається документ', async () => {
    await putDraft(
      draft({ change: { title: 'Протокол зборів', content: { content: [{ content: [{ text: 'Порядок денний', type: 'text' }], type: 'paragraph' }], type: 'doc' } } }),
    );
    const { calls } = mockApi(base({ 'GET /api/papers/p1': () => json(200, paper({ revision: 2 })) }));
    renderApp('/editor/p1');
    expect(await screen.findByLabelText('Текст документа')).toHaveTextContent('Порядок денний');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Відновлено зміни/)).not.toBeInTheDocument();
    await waitFor(async () => expect(await stored()).toBeNull());
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('документ тим часом змінили — вибір: зберегти мої зміни як копію', async () => {
    await putDraft(draft({ change: { title: 'Мій протокол', content: text('Мій текст') } }));
    const { calls } = mockApi(
      base({
        'GET /api/papers/p1': () => json(200, paper({ revision: 3, content: text('Чужий текст') })),
        'POST /api/papers/p1/copy': () => json(201, paper({ id: 'c1' })),
        'GET /api/papers/c1': () => json(200, paper({ id: 'c1', title: 'Мій протокол (копія)', content: text('Мій текст') })),
      }),
    );
    const { router } = renderApp('/editor/p1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('На цьому пристрої лишилися зміни документа «Мій протокол»');
    expect(screen.queryByLabelText('Текст документа')).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Зберегти мої зміни як копію' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/editor/c1'));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body)).toEqual({ title: 'Мій протокол (копія)', content: text('Мій текст'), values: {} });
    expect(await screen.findByLabelText('Текст документа')).toHaveTextContent('Мій текст');
    await waitFor(async () => expect(await stored()).toBeNull());
  });

  it('документ тим часом змінили — «Відкинути мої зміни» відкриває останню версію', async () => {
    await putDraft(draft({ change: { title: 'Мій протокол' } }));
    mockApi(base({ 'GET /api/papers/p1': () => json(200, paper({ revision: 3, content: text('Чужий текст') })) }));
    renderApp('/editor/p1');
    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Відкинути мої зміни' }));
    expect(await screen.findByLabelText('Текст документа')).toHaveTextContent('Чужий текст');
    expect(screen.getByLabelText('Назва документа')).toHaveValue('Протокол зборів');
    await waitFor(async () => expect(await stored()).toBeNull());
  });

  it('документа вже немає — збережене прибирається', async () => {
    await putDraft(draft());
    mockApi(base({ 'GET /api/papers/p1': () => json(404, { errorCode: 'NOT_FOUND' }) }));
    renderApp('/editor/p1');
    await waitFor(async () => expect(await stored()).toBeNull());
  });

  it('конфлікт під час роботи: «Відкрити останню версію» не питає вдруге про ті самі зміни', async () => {
    let version = 1;
    mockApi(
      base({
        'GET /api/papers/p1': () => json(200, version === 1 ? paper() : paper({ revision: 5, content: text('Чужий текст') })),
        'PATCH /api/papers/p1': () => json(409, { errorCode: 'PAPER_CONFLICT' }),
      }),
    );
    renderApp('/editor/p1');
    await userEvent.type(await screen.findByLabelText('Назва документа'), '!');
    const banner = await screen.findByRole('alert', undefined, { timeout: 4000 });
    version = 2;
    await userEvent.click(within(banner).getByRole('button', { name: 'Відкрити останню версію' }));
    expect(await screen.findByText('Чужий текст')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(async () => expect(await stored()).toBeNull());
  });
});
