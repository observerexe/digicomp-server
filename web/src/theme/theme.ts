export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'dc-theme';

export function storedTheme(): ThemeChoice {
  const v = globalThis.localStorage?.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** System by default; a manual choice is kept on this device. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') {
    delete root.dataset.theme;
    localStorage.removeItem(KEY);
  } else {
    root.dataset.theme = choice;
    localStorage.setItem(KEY, choice);
  }
}
