import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'dc-theme';
const DARK = '(prefers-color-scheme: dark)';

export function storedTheme(): ThemeChoice {
  const v = globalThis.localStorage?.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** System by default; a manual choice is kept on this device. Every switch on the screen follows it. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') {
    delete root.dataset.theme;
    localStorage.removeItem(KEY);
  } else {
    root.dataset.theme = choice;
    localStorage.setItem(KEY, choice);
  }
  notify();
}

const systemDark = () => globalThis.matchMedia?.(DARK).matches ?? false;

function subscribe(fn: () => void) {
  listeners.add(fn);
  // «Як у системі»: the system switching its theme switches the shown one.
  const media = globalThis.matchMedia?.(DARK);
  media?.addEventListener?.('change', fn);
  return () => {
    listeners.delete(fn);
    media?.removeEventListener?.('change', fn);
  };
}

/** The choice and the theme shown now (the system's, while the choice is «Як у системі»). */
export function useTheme() {
  const choice = useSyncExternalStore(subscribe, storedTheme);
  const dark = useSyncExternalStore(subscribe, () => (choice === 'system' ? systemDark() : choice === 'dark'));
  return { choice, dark };
}
