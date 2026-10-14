import { base64ToBytes } from '../geo/quantise';
import type { SnapshotFiles } from '../geo/snapshot';

// The committed map snapshot, inlined into the single file at build time (AD-3). Binary files arrive as base64 data
// URLs, JSON files as text. The newest dated folder wins.
const binaries = import.meta.glob<string>('../../data/snapshot/*/*.bin', { query: '?inline', import: 'default', eager: true });
const texts = import.meta.glob<string>('../../data/snapshot/*/*.json', { query: '?raw', import: 'default', eager: true });

function latestFolder(): string {
  const folders = [...new Set(Object.keys(texts).map((k) => /snapshot\/(\d{4}-\d{2}-\d{2})\//.exec(k)?.[1]).filter((f): f is string => f !== undefined))].sort();
  const latest = folders[folders.length - 1];
  if (!latest) throw new Error('No map snapshot is bundled. Run npm run data:fetch.');
  return latest;
}

function bytesFromDataUrl(url: string): Uint8Array {
  const comma = url.indexOf(',');
  return base64ToBytes(url.slice(comma + 1));
}

export function loadSnapshotFiles(): SnapshotFiles {
  const folder = latestFolder();
  const bin = (name: string): Uint8Array => {
    const url = binaries[`../../data/snapshot/${folder}/${name}`];
    if (url === undefined) throw new Error(`Snapshot file missing: ${name}`);
    return bytesFromDataUrl(url);
  };
  const text = (name: string): string => {
    const t = texts[`../../data/snapshot/${folder}/${name}`];
    if (t === undefined) throw new Error(`Snapshot file missing: ${name}`);
    return t;
  };
  return {
    'manifest.json': text('manifest.json'),
    'roads.bin': bin('roads.bin'),
    'buildings.bin': bin('buildings.bin'),
    'areas.bin': bin('areas.bin'),
    'wards.json': text('wards.json'),
    'pois.json': text('pois.json'),
  };
}
