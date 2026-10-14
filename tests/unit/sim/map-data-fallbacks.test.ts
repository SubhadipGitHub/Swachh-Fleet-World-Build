import { describe, expect, it } from 'vitest';
import type { ClusterScale, DerivedFigure } from '../../../src/config/derive';
import { encodeRings } from '../../../src/geo/quantise';
import { decodeSnapshot, encodeSnapshotData, type DecodedSnapshot } from '../../../src/geo/snapshot';
import { buildMapData } from '../../../src/sim/map-data';
import { simplifyRing } from '../../../scripts/data/lib/simplify';
import { gridNetwork } from '../../fixtures/grid';

// Map building when the snapshot has no buildings or points of interest (W-3: sites become `assumed`).

const d = (value: number): DerivedFigure => ({ value, unit: 'count', tag: 'derived', sourceIds: ['kasaflow-assumptions'], asOf: '2026-10-14', derivedFrom: ['smartBins'] });
const SCALE: ClusterScale = {
  population2011: d(1000),
  population2026: d(1600),
  households: d(410),
  perCapitaKgPerDay: d(0.39),
  wasteTpd: d(0.6),
  autoTippers: d(1),
  compactors: d(1),
  blackSpots: d(2),
};

function bare(): DecodedSnapshot {
  const roads = gridNetwork(5, 5, 90, { highway: 'tertiary' });
  return {
    manifest: {
      version: 1,
      fetchedAt: '2026-10-14',
      licence: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      origin: { zone: 43, easting: 0, northing: 0 },
      bboxes: [],
      endpoints: [],
      queries: [],
      wards: [],
      counts: { buildings: 0, roadNodes: roads.nodes.length, roadWays: roads.ways.length, areas: 0, pois: 0 },
      coverage: { buildingsWithLevelsPct: 0, sparseWards: [] },
      files: {
        'roads.bin': { sha256: '', bytes: 0 },
        'buildings.bin': { sha256: '', bytes: 0 },
        'areas.bin': { sha256: '', bytes: 0 },
        'wards.json': { sha256: '', bytes: 0 },
        'pois.json': { sha256: '', bytes: 0 },
      },
    },
    roads,
    buildings: { rings: encodeRings([]), levels: new Uint8Array(0), heightDm: new Uint16Array(0), kind: new Uint8Array(0) },
    areas: { rings: encodeRings([]), kind: new Uint8Array(0) },
    wards: [],
    pois: [],
  };
}

describe('buildMapData without buildings or points of interest', () => {
  it('spreads households by street length and still places every facility and bin', () => {
    const map = buildMapData(bare(), SCALE, { smartBins: 10, transferPoints: 2, seed: 3 });
    expect(map.segments.reduce((a, s) => a + s.households, 0)).toBe(410);
    expect(map.segments.filter((s) => s.households > 0).length).toBeGreaterThan(20);
    expect(map.bins).toHaveLength(10);
    expect(new Set(map.bins.map((b) => b.node)).size).toBe(10);
    expect(map.facilities.transferPoints).toHaveLength(2);
    expect(map.blackSpots).toHaveLength(2);
  });
});

describe('snapshot decoding guards', () => {
  it('rejects a road way with an unknown class code', () => {
    const snap = bare();
    const files = encodeSnapshotData(snap);
    const roads = files['roads.bin'].slice();
    // The first way's class byte follows the header, node ids, node rings and the way id.
    const header = 4 + 4 + 4;
    const nodeIds = snap.roads.nodes.length * 8;
    const ringBlock = 4 + (snap.roads.nodes.length + 1) * 4 + snap.roads.nodes.length * 4;
    roads[header + nodeIds + ringBlock + 8] = 250;
    expect(() => decodeSnapshot({ ...files, 'roads.bin': roads, 'manifest.json': JSON.stringify(snap.manifest) })).toThrow(RangeError);
  });
});

describe('simplifyRing triangle guarantee', () => {
  it('keeps a triangle even when every point is within tolerance of the chord', () => {
    const sliver: [number, number][] = [
      [0, 0],
      [10, 0.1],
      [20, 0],
      [10, -0.1],
      [0, 0],
    ];
    const out = simplifyRing(sliver, 5);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out[0]).toEqual(out[out.length - 1]);
  });
});
