import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Content-Security-Policy for the built single file only (architecture AD-13). `connect-src 'none'` makes runtime
 * network calls impossible (N-6). The dev server serves separate modules and would be blocked by it, so the tag is
 * added at build time only.
 */
export const CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'";

function buildOnlyCsp(): Plugin {
  return {
    name: 'build-only-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  plugins: [preact(), viteSingleFile(), buildOnlyCsp()],
  // The map snapshot's binary files are imported as inline data (AD-3); the build never fetches anything.
  assetsInclude: ['**/*.bin'],
  build: { target: 'es2022', assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false, chunkSizeWarningLimit: 16_000 },
  worker: { format: 'es' },
  test: {
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/property/**/*.test.ts',
      'tests/arch/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/config/**', 'src/geo/**', 'src/routing/**', 'src/sim/**', 'scripts/data/lib/**'],
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
