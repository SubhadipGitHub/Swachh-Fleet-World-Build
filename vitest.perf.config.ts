import { defineConfig } from 'vitest/config';

// Performance gates (architecture AD-14). Run alone, one file at a time, so timings are not disturbed by other suites.
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
