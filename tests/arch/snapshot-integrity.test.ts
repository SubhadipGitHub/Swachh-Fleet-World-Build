import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLUSTER_WARDS } from '../../src/config/calibration';
import { SNAPSHOT_DATA_FILES, type SnapshotManifest } from '../../src/geo/snapshot';

// Requirements P-3 and W-1, architecture AD-3: the committed map snapshot is complete, dated and unedited.

const SNAPSHOT_ROOT = resolve(import.meta.dirname, '../../data/snapshot');

function latestSnapshotDir(): string {
  expect(existsSync(SNAPSHOT_ROOT), 'data/snapshot/ exists (run npm run data:fetch)').toBe(true);
  const dirs = readdirSync(SNAPSHOT_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  expect(dirs.length, 'at least one dated snapshot folder').toBeGreaterThan(0);
  return join(SNAPSHOT_ROOT, dirs[dirs.length - 1]!);
}

function readManifest(dir: string): SnapshotManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as SnapshotManifest;
}

describe('map snapshot integrity (P-3)', () => {
  it('is dated by its folder name and licensed ODbL with attribution', () => {
    const dir = latestSnapshotDir();
    const m = readManifest(dir);
    expect(m.version).toBe(1);
    expect(dir.endsWith(m.fetchedAt)).toBe(true);
    expect(m.licence).toBe('ODbL-1.0');
    expect(m.attribution).toBe('© OpenStreetMap contributors');
    expect(m.queries.length).toBeGreaterThan(0);
    expect(m.endpoints.length).toBeGreaterThan(0);
    expect(m.origin.zone).toBe(43);
  });

  it('every data file matches its recorded SHA-256 and size (no hand edits)', () => {
    const dir = latestSnapshotDir();
    const m = readManifest(dir);
    for (const name of SNAPSHOT_DATA_FILES) {
      const bytes = readFileSync(join(dir, name));
      expect(bytes.length, name).toBe(m.files[name].bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(m.files[name].sha256);
    }
  });

  it('holds exactly the 7 cluster wards with their 2011 populations (data-sources §1a)', () => {
    const m = readManifest(latestSnapshotDir());
    expect(m.wards.map((w) => w.key).sort()).toEqual(CLUSTER_WARDS.map((w) => w.key).sort());
    expect(m.wards.reduce((sum, w) => sum + w.population2011, 0)).toBe(156_598);
  });

  it('has counts in the expected ranges (data-sources §1b)', () => {
    const { counts, coverage } = readManifest(latestSnapshotDir());
    expect(counts.buildings).toBeGreaterThan(8_000);
    expect(counts.buildings).toBeLessThan(30_000);
    expect(counts.roadWays).toBeGreaterThan(1_500);
    expect(counts.roadWays).toBeLessThan(12_000);
    expect(counts.pois).toBeGreaterThan(0);
    expect(coverage.buildingsWithLevelsPct).toBeGreaterThanOrEqual(0);
    expect(coverage.buildingsWithLevelsPct).toBeLessThanOrEqual(100);
  });

  it('stays within the size budget share for map data (N-1: ≤ 4 MB raw)', () => {
    const m = readManifest(latestSnapshotDir());
    const total = SNAPSHOT_DATA_FILES.reduce((sum, name) => sum + m.files[name].bytes, 0);
    expect(total).toBeLessThan(4 * 1024 * 1024);
  });
});
