import { describe, expect, it } from 'vitest';
import { encodeRings } from '../../../src/geo/quantise';
import { decodeSnapshot, encodeSnapshotData, type DecodedSnapshot, type SnapshotManifest } from '../../../src/geo/snapshot';
import { gridNetwork } from '../../fixtures/grid';

// Architecture AD-3: the snapshot codec round-trips everything within quantisation.

const MANIFEST: SnapshotManifest = {
  version: 1,
  fetchedAt: '2026-10-14',
  licence: 'ODbL-1.0',
  attribution: '© OpenStreetMap contributors',
  origin: { zone: 43, easting: 785_000, northing: 1_429_000 },
  bboxes: [[12.89, 77.6, 12.95, 77.66]],
  endpoints: ['https://overpass-api.de/api/interpreter'],
  queries: ['[out:json];way["highway"](12.89,77.6,12.95,77.66);out geom;'],
  wards: [{ key: 'South-72', name: 'HSR Layout', population2011: 18_787 }],
  counts: { buildings: 2, roadNodes: 9, roadWays: 12, areas: 1, pois: 1 },
  coverage: { buildingsWithLevelsPct: 50, sparseWards: [] },
  files: {
    'roads.bin': { sha256: '0'.repeat(64), bytes: 0 },
    'buildings.bin': { sha256: '0'.repeat(64), bytes: 0 },
    'areas.bin': { sha256: '0'.repeat(64), bytes: 0 },
    'wards.json': { sha256: '0'.repeat(64), bytes: 0 },
    'pois.json': { sha256: '0'.repeat(64), bytes: 0 },
  },
};

const ROADS = gridNetwork(3, 3, 100.3, { oneway: (i) => (i === 1 ? 'yes' : i === 4 ? '-1' : 'no'), lanes: 2 });

/** Built on demand so a stubbed encoder fails each test rather than the whole file. */
const data = (): Omit<DecodedSnapshot, 'manifest'> => ({
  roads: { nodes: ROADS.nodes, ways: ROADS.ways.map((w, i) => (i === 0 ? { ...w, name: '27th Main Road', maxspeedKmh: 30 } : w)) },
  buildings: {
    rings: encodeRings([
      [[10, 10], [20, 10], [20, 22], [10, 22], [10, 10]],
      [[40, 40], [48, 40], [44, 47], [40, 40]],
    ]),
    levels: Uint8Array.from([3, 0]),
    heightDm: Uint16Array.from([0, 95]),
    kind: Uint8Array.from([2, 4]),
  },
  areas: { rings: encodeRings([[[0, 0], [50, 0], [50, 50], [0, 0]]]), kind: Uint8Array.from([0]) },
  wards: [{ key: 'South-72', name: 'HSR Layout', population2011: 18_787, rings: [[[0, 0], [300, 0], [300, 300], [0, 300], [0, 0]]] }],
  pois: [{ kind: 'kcdc', osmId: 287_327_441, name: 'Karnataka Compost Development Centre - KCDC', x: 150.4, y: -20.1 }],
});

function roundTrip(): DecodedSnapshot {
  const files = encodeSnapshotData(data());
  return decodeSnapshot({ ...files, 'manifest.json': JSON.stringify(MANIFEST) });
}

describe('snapshot codec', () => {
  it('returns the manifest unchanged', () => {
    expect(roundTrip().manifest).toEqual(MANIFEST);
  });

  it('round-trips roads: ids, tags exactly; coordinates within 0.125 m', () => {
    const back = roundTrip().roads;
    expect(back.ways).toEqual(data().roads.ways);
    expect(back.nodes.map((n) => n.id)).toEqual(data().roads.nodes.map((n) => n.id));
    back.nodes.forEach((n, i) => {
      expect(Math.abs(n.x - data().roads.nodes[i]!.x)).toBeLessThanOrEqual(0.125);
      expect(Math.abs(n.y - data().roads.nodes[i]!.y)).toBeLessThanOrEqual(0.125);
    });
  });

  it('round-trips buildings and areas exactly (already quantised)', () => {
    const back = roundTrip();
    expect([...back.buildings.rings.coords]).toEqual([...data().buildings.rings.coords]);
    expect([...back.buildings.rings.starts]).toEqual([...data().buildings.rings.starts]);
    expect([...back.buildings.levels]).toEqual([3, 0]);
    expect([...back.buildings.heightDm]).toEqual([0, 95]);
    expect([...back.buildings.kind]).toEqual([2, 4]);
    expect([...back.areas.kind]).toEqual([0]);
  });

  it('round-trips wards and POIs', () => {
    const back = roundTrip();
    expect(back.wards).toEqual(data().wards);
    expect(back.pois).toEqual(data().pois);
  });

  it('rejects an unknown manifest version', () => {
    const files = encodeSnapshotData(data());
    expect(() => decodeSnapshot({ ...files, 'manifest.json': JSON.stringify({ ...MANIFEST, version: 2 }) })).toThrow();
  });

  it('rejects a truncated binary file', () => {
    const files = encodeSnapshotData(data());
    expect(() => decodeSnapshot({ ...files, 'roads.bin': files['roads.bin'].slice(0, 7), 'manifest.json': JSON.stringify(MANIFEST) })).toThrow();
  });
});
