import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Architecture AD-2: the pure layers never reach Three.js, Preact, the DOM, wall-clock time or unseeded randomness,
// directly or through any import chain.

const ROOT = resolve(import.meta.dirname, '../..');
const PURE_DIRS = ['src/shared', 'src/config', 'src/geo', 'src/routing', 'src/sim', 'src/lab'];
const BANNED_PACKAGES = [/^three(\/|$)/, /^preact(\/|$)/, /^@preact\//];
const BANNED_DIRS = ['src/render', 'src/ui', 'src/app', 'src/workers'];
const BANNED_GLOBALS: readonly [RegExp, string][] = [
  [/\bMath\.random\b/, 'Math.random'],
  [/\bnew Date\b|\bDate\.(now|UTC|parse)\b/, 'Date'],
  [/\bperformance\./, 'performance'],
  [/\bwindow\./, 'window'],
  [/\bdocument\./, 'document'],
  [/\bself\./, 'self'],
];

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) specs.push((m[1] ?? m[2] ?? m[3])!);
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const pureFiles = PURE_DIRS.flatMap((d) => walk(join(ROOT, d)));

describe('architecture boundaries (AD-2)', () => {
  it('finds the pure-layer sources', () => {
    expect(pureFiles.length).toBeGreaterThan(10);
  });

  it('pure layers never reach rendering, UI, app or worker code through any import chain', () => {
    const violations: string[] = [];
    for (const start of pureFiles) {
      const seen = new Set<string>();
      const stack: { file: string; chain: string[] }[] = [{ file: start, chain: [] }];
      while (stack.length > 0) {
        const { file, chain } = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        if (BANNED_DIRS.some((d) => rel.startsWith(`${d}/`))) {
          violations.push([...chain, rel].join(' → '));
          continue;
        }
        for (const spec of importsOf(file)) {
          if (BANNED_PACKAGES.some((re) => re.test(spec))) violations.push([...chain, rel, spec].join(' → '));
          const local = resolveLocal(file, spec);
          if (local) stack.push({ file: local, chain: [...chain, rel] });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('pure layers use no wall clock, unseeded randomness or DOM globals', () => {
    const violations: string[] = [];
    for (const file of pureFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [re, name] of BANNED_GLOBALS) {
        if (re.test(code)) violations.push(`${relative(ROOT, file)}: ${name}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
