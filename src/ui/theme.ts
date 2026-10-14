export type Theme = 'dark' | 'light';
export const THEME_KEY = 'kasaflow.theme';

/** The part of Storage the theme needs; any call may throw (private mode, blocked storage). */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** X-4, M2-13: the saved theme, or dark when nothing valid is saved, there is no storage, or reading throws. */
export function loadTheme(storage: ThemeStorage | null): Theme {
  try {
    return storage?.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Saves the theme; returns false (never throws) if storage is missing or refuses. */
export function saveTheme(storage: ThemeStorage | null, theme: Theme): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
