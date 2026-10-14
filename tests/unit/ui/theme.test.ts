import { describe, expect, it } from 'vitest';
import { THEME_KEY, loadTheme, saveTheme, type ThemeStorage } from '../../../src/ui/theme';

// Requirements X-4 and architecture M2-13: the theme is remembered, and a storage failure is harmless.

function memory(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const broken: ThemeStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('theme', () => {
  it('defaults to dark', () => {
    expect(loadTheme(null)).toBe('dark');
    expect(loadTheme(memory())).toBe('dark');
    expect(loadTheme(memory({ [THEME_KEY]: 'blue' }))).toBe('dark');
  });

  it('remembers the saved theme', () => {
    const s = memory();
    expect(saveTheme(s, 'light')).toBe(true);
    expect(s.data[THEME_KEY]).toBe('light');
    expect(loadTheme(s)).toBe('light');
  });

  it('never throws when storage refuses', () => {
    expect(loadTheme(broken)).toBe('dark');
    expect(saveTheme(broken, 'light')).toBe(false);
    expect(saveTheme(null, 'light')).toBe(false);
  });
});
