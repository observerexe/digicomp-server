import 'fake-indexeddb/auto';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, unwrap } from '../api/client';
import { claimDraft, draftKey, dropDrafts, putDraft, releaseDraft, sendDrafts, type DraftTarget, type LocalDraft } from '../lib/localDrafts';
import { json, member, mockApi, renderApp } from '../test/render';
import { RETRY_DELAY, SAVE_DELAY, useAutosave } from './useAutosave';

type Change = { title: string; content: Record<string, unknown>; values: Record<string, unknown> };

const P1: DraftTarget = { kind: 'paper', id: 'p1' };
const KEY = draftKey('u1', P1);
const useSaving = (revision: number, restored?: Partial<Change>) =>
  useAutosave<Change>((change, rev) => unwrap(api.PATCH('/api/papers/{id}', { params: { path: { id: 'p1' } }, body: { revision: rev, ...change } })), revision, {
    userId: 'u1',
    target: P1,
    restored,
  });

const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const savedAt = (revision: number) =>
  json(200, {
    id: 'p1',
    title: 'x',
    status: 'draft',
    visibility: 'author',
    author: { id: 'u1', name: 'М', avatarUrl: null },
    revision,
    createdAt: '',
    updatedAt: '2026-11-14T12:30:00Z',
  });
const draft = (over: Partial<LocalDraft> & { target?: DraftTarget } = {}): LocalDraft => {
  const target = over.target ?? P1;
  const userId = over.userId ?? 'u1';
  return { key: draftKey(userId, target), userId, target, revision: 1, change: { title: 'Мій протокол' }, at: '2026-11-16T09:00:00Z', ...over };
};

/** What the device keeps for a key (read the way an editor does). */
const stored = async (key = KEY) => {
  const d = await claimDraft(key);
  releaseDraft(key);
  return d;
};
/** IndexedDB answers in macrotasks: let them run. */
const idle = async () => {
  for (let i = 0; i < 10; i++) await act(() => new Promise<void>((r) => setImmediate(r)));
};
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

afterEach(() => dropDrafts());

describe('Чернетка на пристрої: автозбереження', () => {
  // IndexedDB runs on setImmediate: only the autosave's timers are fake.
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('зміни лежать на пристрої, доки сервер їх не отримав, і зникають після', async () => {
    let release!: () => void;
    let rev = 1;
    mockApi({
      'PATCH /api/papers/p1': async () => {
        if (rev === 1) await new Promise<void>((r) => (release = r));
        return savedAt(++rev);
      },
    });
    const { result } = renderHook(() => useSaving(1));
    act(() => result.current.change({ content: text('а') }));
    await idle();
    expect(await stored()).toMatchObject({ userId: 'u1', target: P1, revision: 1, change: { content: text('а') } });

    // On its way and changed meanwhile: both are kept, with the revision they go with.
    await wait(SAVE_DELAY);
    expect(result.current.state).toBe('saving');
    act(() => result.current.change({ title: 'Звіт' }));
    await idle();
    expect(await stored()).toMatchObject({ revision: 1, change: { content: text('а'), title: 'Звіт' } });

    // The change made meanwhile goes after its pause, with the next revision.
    release();
    await idle();
    expect(result.current.state).toBe('dirty');
    expect(await stored()).toMatchObject({ revision: 2, change: { title: 'Звіт' } });
    await wait(SAVE_DELAY);
    await idle();
    expect(result.current.state).toBe('saved');
    expect(await stored()).toBeNull();
  });

  it('без зв’язку — «збережено на пристрої»; зв’язок повернувся — надсилає одразу', async () => {
    let online = false;
    const { calls } = mockApi({ 'PATCH /api/papers/p1': () => (online ? savedAt(2) : Promise.reject(new TypeError('Failed to fetch'))) });
    const { result } = renderHook(() => useSaving(1));
    act(() => result.current.change({ title: 'Звіт' }));
    await idle();
    await wait(SAVE_DELAY);
    await idle();
    expect(result.current.state).toBe('local');
    expect(await stored()).toMatchObject({ revision: 1, change: { title: 'Звіт' } });

    online = true;
    act(() => void window.dispatchEvent(new Event('online')));
    await idle();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.body)).toEqual({ revision: 1, title: 'Звіт' });
    expect(result.current.state).toBe('saved');
    expect(await stored()).toBeNull();

    // No retry left behind.
    await wait(RETRY_DELAY);
    expect(calls).toHaveLength(2);
  });

  it('збережене минулого разу надсилається одразу', async () => {
    await putDraft(draft({ change: { title: 'Мій протокол' } }));
    const { calls } = mockApi({ 'PATCH /api/papers/p1': () => savedAt(2) });
    const { result } = renderHook(() => useSaving(1, { title: 'Мій протокол' }));
    await idle();
    expect(JSON.parse(calls[0]!.body)).toEqual({ revision: 1, title: 'Мій протокол' });
    expect(result.current.state).toBe('saved');
    expect(await stored()).toBeNull();
  });

  it('конфлікт лишає зміни на пристрої; cancel — прибирає', async () => {
    mockApi({ 'PATCH /api/papers/p1': () => json(409, { errorCode: 'PAPER_CONFLICT' }) });
    const { result } = renderHook(() => useSaving(1));
    act(() => result.current.change({ title: 'Звіт' }));
    await wait(SAVE_DELAY);
    await idle();
    expect(result.current.state).toBe('conflict');
    expect(await stored()).toMatchObject({ revision: 1, change: { title: 'Звіт' } });
    act(() => result.current.cancel());
    await idle();
    expect(await stored()).toBeNull();
  });
});

describe('Чернетки на пристрої: досилання й очищення', () => {
  it('надсилає чернетки людини, яких не тримає редактор; отримане — прибирає, решту лишає', async () => {
    const T1: DraftTarget = { kind: 'template', id: 't1', v: 2 };
    await putDraft(draft({ revision: 3 }));
    await putDraft(draft({ target: T1, change: { body: text('Шаблон') } }));
    await putDraft(draft({ target: { kind: 'paper', id: 'p2' } }));
    await putDraft(draft({ userId: 'u2', target: { kind: 'paper', id: 'p3' } }));
    const { calls } = mockApi({
      'PATCH /api/papers/p1': () => savedAt(4),
      'PATCH /api/papers/templates/t1/versions/2': () => json(409, { errorCode: 'PAPER_CONFLICT' }),
    });
    const openKey = draftKey('u1', { kind: 'paper', id: 'p2' });
    await claimDraft(openKey);
    await sendDrafts('u1');
    releaseDraft(openKey);

    expect(calls.map((c) => c.path).sort()).toEqual(['/api/papers/p1', '/api/papers/templates/t1/versions/2']);
    expect(JSON.parse(calls.find((c) => c.path === '/api/papers/p1')!.body)).toEqual({ revision: 3, title: 'Мій протокол' });
    expect(await stored()).toBeNull();
    expect(await stored(draftKey('u1', T1))).not.toBeNull();
    expect(await stored(openKey)).not.toBeNull();
    expect(await stored(draftKey('u2', { kind: 'paper', id: 'p3' }))).not.toBeNull();
  });

  it('редактор, що відкривається під час досилання своєї чернетки, чекає на нього й читає вже отримане', async () => {
    await putDraft(draft());
    let release!: () => void;
    mockApi({ 'PATCH /api/papers/p1': () => new Promise<Response>((r) => (release = () => r(savedAt(2)))) });
    const sent = sendDrafts('u1');
    await waitFor(() => expect(release).toBeDefined());
    let claimed: LocalDraft | null | undefined;
    const claim = claimDraft(KEY).then((d) => (claimed = d));
    await new Promise((r) => setTimeout(r, 20));
    expect(claimed).toBeUndefined();
    release();
    await sent;
    await claim;
    releaseDraft(KEY);
    expect(claimed).toBeNull();
  });

  it('вхід лишає лише чернетки цієї людини й надсилає їх; вихід прибирає все', async () => {
    const other = draftKey('u2', { kind: 'paper', id: 'p3' });
    await putDraft(draft());
    await putDraft(draft({ userId: 'u2', target: { kind: 'paper', id: 'p3' } }));
    let session = true;
    const { calls } = mockApi({
      'GET /api/auth/me': () => (session ? json(200, member) : json(401, {})),
      'POST /api/auth/refresh': () => json(401, {}),
      'POST /api/auth/logout': () => {
        session = false;
        return json(200, { ok: true });
      },
      'PATCH /api/papers/p1': () => json(500, { errorCode: 'INTERNAL' }),
    });
    const { router } = renderApp('/more');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/papers/p1')).toBe(true));
    expect(await stored(other)).toBeNull();
    expect(await stored()).not.toBeNull();

    await userEvent.click(await screen.findByRole('button', { name: 'Вийти' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await waitFor(async () => expect(await stored()).toBeNull());
  });
});

describe('Чернетка на пристрої: застосунок відкрили одразу на документі', () => {
  it('хоч би хто надіслав зміни першим — фон чи редактор — вони доходять один раз, без конфлікту', async () => {
    await putDraft(draft({ change: { title: 'Мій протокол' } }));
    const writer = { ...member, permissions: [...member.permissions, 'papers.read', 'papers.create', 'papers.edit'] };
    let server = { title: 'Протокол зборів', revision: 1 };
    const paper = () => ({
      id: 'p1',
      ...server,
      status: 'draft',
      visibility: 'author',
      author: { id: 'u1', name: 'Марта Коваль', avatarUrl: null },
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
    });
    const { calls } = mockApi({
      'GET /api/auth/me': () => json(200, writer),
      'GET /api/work-sessions': () => json(200, { items: [], total: 0, page: 1, limit: 1 }),
      'GET /api/papers/p1': () => json(200, paper()),
      'PATCH /api/papers/p1': async (req) => {
        const body = (await req.json()) as { revision: number; title: string };
        if (body.revision !== server.revision) return json(409, { errorCode: 'PAPER_CONFLICT' });
        server = { title: body.title, revision: server.revision + 1 };
        return json(200, paper());
      },
    });
    renderApp('/editor/p1');
    await screen.findByLabelText('Текст документа');
    expect(screen.getByLabelText('Назва документа')).toHaveValue('Мій протокол');
    await waitFor(() => expect(server.revision).toBe(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    await waitFor(async () => expect(await stored()).toBeNull());
  });
});
