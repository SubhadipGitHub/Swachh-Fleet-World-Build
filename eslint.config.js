import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** The pure layers (architecture AD-2): no rendering, UI, DOM or wall-clock access, and no unseeded randomness. */
const PURE = ['src/shared/**/*.ts', 'src/config/**/*.ts', 'src/geo/**/*.ts', 'src/routing/**/*.ts', 'src/sim/**/*.ts', 'src/lab/**/*.ts'];

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'playwright-report/', 'test-results/', '.cache/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: PURE,
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*', 'preact', 'preact/*', '@preact/*'], message: 'Pure layers must not depend on rendering or UI (AD-2).' },
            { group: ['**/render/**', '**/ui/**', '**/app/**', '**/workers/**'], message: 'Pure layers must not import the view or worker hosts (AD-2).' },
          ],
        },
      ],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use a seeded stream from sim/rng (AD-5).' }],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Use the sim clock, not wall time (AD-5).' },
        { name: 'performance', message: 'Use the sim clock, not wall time (AD-5).' },
        { name: 'window', message: 'No DOM in pure layers (AD-2).' },
        { name: 'document', message: 'No DOM in pure layers (AD-2).' },
        { name: 'self', message: 'No worker globals in pure layers (AD-2).' },
      ],
    },
  },
  {
    // Test idioms: `!` after an asserted length, and expect(() => fn()).toThrow().
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
);
