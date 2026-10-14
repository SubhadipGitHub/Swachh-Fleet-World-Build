import { describe, expect, it } from 'vitest';
import type { ClusterScale, DerivedFigure } from '../../../src/config/derive';
import { encodeRings, type Point } from '../../../src/geo/quantise';
import type { DecodedSnapshot } from '../../../src/geo/snapshot';
import { buildGraph } from '../../../src/routing/graph';
import { largestComponentMask } from '../../../src/routing/scc';
import { buildMapData, findFloodProneSpots } from '../../../src/sim/map-data';
import { gridNetwork } from '../../fixtures/grid';

// Architecture M2-5: flood-prone spots (assumed) near water close in a monsoon.

const d = (value: number): DerivedFigure => ({ value, unit: 'count', tag: 'derived', sourceIds: ['kasaflow-assumptions'], asOf: '2026-10-14', derivedFrom: ['smartBins'] });
const SCALE: ClusterScale = {
  population2011: d(1000),
  population2026: d(1600),
  households: d(410),
  perCapitaKgPerDay: d(0.39),
  wasteTpd: d(0.6),
  autoTippers: d(1),
  compactors: d(1),
  blackSpots: d(1),
};

/** A lake in the south-west corner of a 10 × 10 grid of 80 m blocks (720 m across). */
const LAKE: Point[] = [
  [20, 20],
  [140, 20],
  [140, 140],
  [20, 140],
  [20, 20],
];

function snapshot(water: Point[][]): DecodedSnapshot {
  const roads = gridNetwork(10, 10, 80);
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
      counts: { buildings: 0, roadNodes: roads.nodes.length, roadWays: roads.ways.length, areas: water.length, pois: 0 },
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
    areas: { rings: encodeRings(water), kind: new Uint8Array(water.length) },
    wards: [],
    pois: [],
  };
}

function edgeDistance(g: ReturnType<typeof buildGraph>, e: number, px: number, py: number): number {
  let best = Infinity;
  for (let k = g.shapeStart[e]!; k + 1 < g.shapeStart[e + 1]!; k++) {
    const ax = g.shapeXY[2 * k]!;
    const ay = g.shapeXY[2 * k + 1]!;
    const bx = g.shapeXY[2 * k + 2]!;
    const by = g.shapeXY[2 * k + 3]!;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    best = Math.min(best, Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)));
  }
  return best;
}

function distanceToLake(x: number, y: number): number {
  const inside = x >= 20 && x <= 140 && y >= 20 && y <= 140;
  if (inside) return 0;
  const dx = Math.max(20 - x, 0, x - 140);
  const dy = Math.max(20 - y, 0, y - 140);
  return Math.hypot(dx, dy);
}

describe('findFloodProneSpots', () => {
  it('puts at most 12 spots on nodes within 120 m of water, closing nearby edges in both directions', () => {
    const snap = snapshot([LAKE]);
    const g = buildGraph(snap.roads);
    const spots = findFloodProneSpots(g, snap.areas, largestComponentMask(g));
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.length).toBeLessThanOrEqual(12);
    expect(spots.map((s) => s.id)).toEqual(spots.map((_, i) => i));
    for (const s of spots) {
      expect(distanceToLake(g.nodeX[s.node]!, g.nodeY[s.node]!)).toBeLessThanOrEqual(120);
      expect(s.edges.length).toBeGreaterThan(0);
      const px = g.nodeX[s.node]!;
      const py = g.nodeY[s.node]!;
      for (let e = 0; e < g.edgeCount; e++) {
        const near = edgeDistance(g, e, px, py) <= 40 + 1e-9;
        expect(s.edges.includes(e), `edge ${e} near=${String(near)}`).toBe(near);
      }
    }
  });

  it('is deterministic and finds nothing without water', () => {
    const snap = snapshot([LAKE]);
    const g = buildGraph(snap.roads);
    const mask = largestComponentMask(g);
    expect(findFloodProneSpots(g, snap.areas, mask)).toEqual(findFloodProneSpots(g, snap.areas, mask));
    const dry = snapshot([]);
    const g2 = buildGraph(dry.roads);
    expect(findFloodProneSpots(g2, dry.areas, largestComponentMask(g2))).toEqual([]);
  });
});

describe('buildMapData', () => {
  it('includes the flood-prone spots', () => {
    const map = buildMapData(snapshot([LAKE]), SCALE, { smartBins: 4, transferPoints: 1, seed: 1 });
    expect(map.floodProneSpots.length).toBeGreaterThan(0);
  });
});
