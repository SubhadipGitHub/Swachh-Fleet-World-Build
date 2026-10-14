import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SnapshotFiles } from '../../src/geo/snapshot';

/** The latest committed snapshot, for the performance gates. */
export function loadLatestSnapshot(): SnapshotFiles {
  const root = resolve(import.meta.dirname, '../../data/snapshot');
  const dir = join(root, readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop()!);
  const bin = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)));
  const text = (name: string): string => readFileSync(join(dir, name), 'utf8');
  return {
    'manifest.json': text('manifest.json'),
    'roads.bin': bin('roads.bin'),
    'buildings.bin': bin('buildings.bin'),
    'areas.bin': bin('areas.bin'),
    'wards.json': text('wards.json'),
    'pois.json': text('pois.json'),
  };
}
