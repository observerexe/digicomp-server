import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi } from '../test/render';
import { RETRY_DELAY, SAVE_DELAY, useAutosave } from './useAutosave';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const saved = (revision: number) => json(200, { id: 'p1', title: 'x', status: 'draft', visibility: 'author', author: { id: 'u1', name: 'М', avatarUrl: null }, revision, createdAt: '', updatedAt: '2026-11-14T12:30:00Z' });

/** Lets pending promises (fetch, unwrap) settle under fake timers. */
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('Автозбереження чернетки', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
  afterEach(() => vi.useRealTimers());

  it('зберігає після паузи один раз, з останнім значенням і revision', async () => {
    let rev = 3;
    const { calls } = mockApi({ 'PATCH /api/papers/p1': () => saved(++rev) });
    const { result } = renderHook(() => useAutosave('p1', 3));
    act(() => result.current.change({ content: doc('а') }));
    await wait(SAVE_DELAY - 100);
    act(() => result.current.change({ content: doc('аб'), title: 'Звіт' }));
    expect(result.current.state).toBe('dirty');
    await wait(SAVE_DELAY - 100);
    expect(calls).toHaveLength(0);
    await wait(200);
    await settle();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body)).toEqual({ revision: 3, content: doc('аб'), title: 'Звіт' });
    expect(result.current.state).toBe('saved');
    expect(result.current.savedAt).toEqual(new Date('2026-11-14T12:30:00Z'));

    // The next save goes with the new revision.
    act(() => result.current.change({ title: 'Звіт 2' }));
    await wait(SAVE_DELAY);
    await settle();
    expect(JSON.parse(calls[1]!.body)).toEqual({ revision: 4, title: 'Звіт 2' });
  });

  it('зміни під час запиту йдуть наступним запитом, не разом і не паралельно', async () => {
    let release!: () => void;
    let rev = 1;
    const { calls } = mockApi({
      'PATCH /api/papers/p1': async () => {
        if (rev === 1) await new Promise<void>((r) => (release = r));
        return saved(++rev);
      },
    });
    const { result } = renderHook(() => useAutosave('p1', 1));
    act(() => result.current.change({ title: 'Один' }));
    await wait(SAVE_DELAY);
    expect(result.current.state).toBe('saving');
    act(() => result.current.change({ title: 'Два' }));
    await wait(SAVE_DELAY);
    expect(calls).toHaveLength(1);
    release();
    await settle();
    await wait(0);
    await settle();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.body)).toEqual({ revision: 2, title: 'Два' });
    expect(result.current.state).toBe('saved');
  });

  it('409 PAPER_CONFLICT — збереження зупиняється', async () => {
    const { calls } = mockApi({ 'PATCH /api/papers/p1': () => json(409, { errorCode: 'PAPER_CONFLICT' }) });
    const { result } = renderHook(() => useAutosave('p1', 1));
    act(() => result.current.change({ title: 'Моє' }));
    await wait(SAVE_DELAY);
    await settle();
    expect(result.current.state).toBe('conflict');
    act(() => result.current.change({ title: 'Ще' }));
    await wait(RETRY_DELAY * 2);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('помилка мережі — повтор пізніше з тими самими змінами', async () => {
    let fail = true;
    const { calls } = mockApi({ 'PATCH /api/papers/p1': () => (fail ? json(500, { errorCode: 'INTERNAL' }) : saved(2)) });
    const { result } = renderHook(() => useAutosave('p1', 1));
    act(() => result.current.change({ title: 'Моє' }));
    await wait(SAVE_DELAY);
    await settle();
    expect(result.current.state).toBe('error');
    fail = false;
    await wait(RETRY_DELAY);
    await settle();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.body)).toEqual({ revision: 1, title: 'Моє' });
    expect(result.current.state).toBe('saved');
  });

  it('вихід зі сторінки зберігає одразу; cancel — нічого не надсилає', async () => {
    const { calls } = mockApi({ 'PATCH /api/papers/p1': () => saved(2) });
    const first = renderHook(() => useAutosave('p1', 1));
    act(() => first.result.current.change({ title: 'Моє' }));
    first.unmount();
    await settle();
    expect(calls).toHaveLength(1);

    const second = renderHook(() => useAutosave('p1', 2));
    act(() => second.result.current.change({ title: 'Інше' }));
    act(() => second.result.current.cancel());
    second.unmount();
    await wait(SAVE_DELAY);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('відмова сервера (400): не повторює сам, причину видно; наступна зміна йде разом із відхиленою', async () => {
    let refuse = true;
    const { calls } = mockApi({
      'PATCH /api/papers/p1': () => (refuse ? json(400, { errorCode: 'PAPER_FIELD_INVALID', field: 'count' }) : saved(2)),
    });
    const { result } = renderHook(() => useAutosave('p1', 1));
    act(() => result.current.change({ values: { count: 99 } }));
    await wait(SAVE_DELAY);
    await settle();
    expect(result.current.state).toBe('rejected');
    expect(result.current.rejection).toMatchObject({ code: 'PAPER_FIELD_INVALID', field: 'count' });
    await wait(RETRY_DELAY * 2);
    await settle();
    expect(calls).toHaveLength(1);

    refuse = false;
    act(() => result.current.change({ title: 'Звіт' }));
    expect(result.current.state).toBe('dirty');
    await wait(SAVE_DELAY);
    await settle();
    expect(JSON.parse(calls[1]!.body)).toEqual({ revision: 1, values: { count: 99 }, title: 'Звіт' });
    expect(result.current.state).toBe('saved');
    expect(result.current.rejection).toBeNull();
  });
});
