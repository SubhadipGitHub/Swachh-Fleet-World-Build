import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCE_IDS, TAGS, sourceMeta, type Tag } from '../../src/config/sources';
import { getCalibration, type Figure } from '../../src/config/calibration';

// Architecture AD-9 and requirements P-1/P-2: code and docs/data-sources.md list the same sources with the same tags,
// and every calibration figure carries valid provenance.

const DOC = readFileSync(resolve(import.meta.dirname, '../../docs/data-sources.md'), 'utf8');

function docSourceTable(): Map<string, string> {
  const section = DOC.split(/^## Source IDs\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const rows = new Map<string, string>();
  for (const line of section.split('\n')) {
    const m = /^\|\s*`([a-z0-9-]+)`\s*\|\s*([a-z]+)\s*\|/.exec(line);
    if (m) rows.set(m[1]!, m[2]!);
  }
  return rows;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('source registry matches docs/data-sources.md', () => {
  const doc = docSourceTable();

  it('the doc has a Source IDs table', () => {
    expect(doc.size).toBeGreaterThan(0);
  });

  it('lists exactly the same ids in code and doc', () => {
    expect([...doc.keys()].sort()).toEqual([...SOURCE_IDS].sort());
  });

  it('doc tags are valid tags', () => {
    for (const tag of doc.values()) expect(TAGS).toContain(tag);
  });

  it.each(SOURCE_IDS.map((id) => [id]))('%s has metadata matching the doc', (id) => {
    const meta = sourceMeta(id);
    expect(meta.id).toBe(id);
    expect(meta.tag).toBe(doc.get(id));
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.asOf).toMatch(ISO_DATE);
    if (meta.tag === 'real') expect(meta.url).toMatch(/^https:\/\//);
  });
});

describe('calibration figures carry valid provenance (P-1)', () => {
  const entries = (): [string, Figure<unknown>][] => Object.entries(getCalibration()) as [string, Figure<unknown>][];

  it('every figure has a tag, unit, date and at least one source', () => {
    for (const [key, f] of entries()) {
      expect(TAGS, key).toContain(f.tag);
      expect(f.unit.length, key).toBeGreaterThan(0);
      expect(f.asOf, key).toMatch(ISO_DATE);
      expect(f.sourceIds.length, key).toBeGreaterThan(0);
    }
  });

  it('a figure tagged real cites at least one real source', () => {
    for (const [key, f] of entries()) {
      if (f.tag !== 'real') continue;
      expect(f.sourceIds.some((id) => sourceMeta(id).tag === 'real'), key).toBe(true);
    }
  });

  it('an assumed figure cites the assumptions log and explains itself', () => {
    for (const [key, f] of entries()) {
      if (f.tag !== 'assumed') continue;
      expect(f.sourceIds, key).toContain('kasaflow-assumptions');
      expect(f.note?.length ?? 0, key).toBeGreaterThan(10);
    }
  });

  it('no config figure is tagged synthetic (synthetic values only come from the simulation)', () => {
    for (const [key, f] of entries()) expect(f.tag satisfies Tag, key).not.toBe('synthetic');
  });
});
