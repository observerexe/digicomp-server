import { describe, expect, it, vi } from 'vitest';
import { createUpdater, RELOAD_GUARD_MS } from './appUpdate';

function setup(hidden = false) {
  const store = new Map<string, string>();
  const env = {
    hidden: vi.fn(() => hidden),
    reload: vi.fn(),
    now: vi.fn(() => 1_000_000),
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
  return { env, u: createUpdater(env) };
}

describe('Оновлення застосунку', () => {
  it('нова версія на видимій сторінці чекає: посеред роботи сторінка не перевантажується', () => {
    const { env, u } = setup(false);
    u.ready();
    expect(env.reload).not.toHaveBeenCalled();
    expect(u.pending).toBe(true);
  });

  it('застосунок згорнули — сторінка перевантажується в нову версію', () => {
    const { env, u } = setup(false);
    u.ready();
    u.hidden();
    expect(env.reload).toHaveBeenCalledOnce();
    expect(u.pending).toBe(false);
  });

  it('перехід на іншу сторінку — нова версія вмикається', () => {
    const { env, u } = setup(false);
    u.ready();
    u.navigated();
    expect(env.reload).toHaveBeenCalledOnce();
  });

  it('прихована сторінка оновлюється одразу', () => {
    const { env, u } = setup(true);
    u.ready();
    expect(env.reload).toHaveBeenCalledOnce();
  });

  it('без нової версії ні згортання, ні переходи не перевантажують', () => {
    const { env, u } = setup(false);
    u.hidden();
    u.navigated();
    expect(env.reload).not.toHaveBeenCalled();
  });

  it('файл коду старої версії не знайшовся — перевантаження один раз, без циклу', () => {
    const { env, u } = setup(false);
    expect(u.chunkFailed()).toBe(true);
    expect(u.chunkFailed()).toBe(false);
    expect(env.reload).toHaveBeenCalledOnce();
    env.now.mockReturnValue(1_000_000 + RELOAD_GUARD_MS);
    expect(u.chunkFailed()).toBe(true);
    expect(env.reload).toHaveBeenCalledTimes(2);
  });

  it('без sessionStorage перевантаження все одно відбувається', () => {
    const reload = vi.fn();
    const u = createUpdater({ hidden: () => false, reload, now: () => 5, storage: null });
    expect(u.chunkFailed()).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
