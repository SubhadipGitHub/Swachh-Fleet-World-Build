import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCalibration } from '../../../src/config/calibration';
import { deriveClusterScale } from '../../../src/config/derive';
import { TAGS, sourceMeta } from '../../../src/config/sources';
import type { SnapshotManifest } from '../../../src/geo/snapshot';
import { dataSourceRows } from '../../../src/sim/provenance-rows';

// Requirements D-9, P-2 and architecture M2-12: the Data sources dialog lists every figure with its provenance.

function manifest(): SnapshotManifest {
  const root = resolve(import.meta.dirname, '../../../data/snapshot');
  const dir = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop()!;
  return JSON.parse(readFileSync(join(root, dir, 'manifest.json'), 'utf8')) as SnapshotManifest;
}

describe('dataSourceRows', () => {
  const cal = getCalibration();
  const scale = deriveClusterScale(cal);
  const rows = (): ReturnType<typeof dataSourceRows> => dataSourceRows(cal, scale, manifest());

  it('has one row per calibration figure and per derived figure', () => {
    const r = rows();
    expect(r.filter((x) => x.group === 'Calibration').map((x) => x.key).sort()).toEqual(Object.keys(cal).sort());
    expect(r.filter((x) => x.group === 'Derived').map((x) => x.key).sort()).toEqual(Object.keys(scale).sort());
  });

  it('gives every row a valid tag, a date and its sources by title', () => {
    for (const row of rows()) {
      expect(TAGS, row.key).toContain(row.tag);
      expect(row.asOf, row.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.value.length, row.key).toBeGreaterThan(0);
      expect(row.sources.length, row.key).toBeGreaterThan(0);
      if (row.tag === 'real') expect(row.sources.some((s) => s.url?.startsWith('https://')), row.key).toBe(true);
    }
    const waste = rows().find((r) => r.key === 'cityWasteTpd')!;
    expect(waste.sources[0]!.title).toBe(sourceMeta('bswml-dh-5500tpd').title);
  });

  it('formats values with units in the Indian numbering system', () => {
    const r = rows();
    expect(r.find((x) => x.key === 'cityWasteTpd')!.value).toBe('5,500 t/day');
    expect(r.find((x) => x.key === 'population2011')!.value).toBe('1,56,598 people');
  });

  it('shows conflicting published values and what derived figures come from', () => {
    const r = rows();
    expect(r.find((x) => x.key === 'kcdcIntakeCapTpd')!.alternatives).toHaveLength(3);
    expect(r.find((x) => x.key === 'households')!.derivedFrom!.length).toBeGreaterThan(0);
  });

  it('includes the OSM snapshot with its date and licence, and the simulated streams', () => {
    const r = rows();
    const osm = r.find((x) => x.key === 'osm-snapshot')!;
    expect(osm.group).toBe('Map snapshot');
    expect(osm.tag).toBe('real');
    expect(osm.asOf).toBe(manifest().fetchedAt);
    expect(osm.value).toContain('ODbL');
    const sim = r.find((x) => x.key === 'simulation')!;
    expect(sim.tag).toBe('synthetic');
  });
});
