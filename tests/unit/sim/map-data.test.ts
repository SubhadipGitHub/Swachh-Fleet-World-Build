import { describe, expect, it } from 'vitest';
import type { ClusterScale, DerivedFigure } from '../../../src/config/derive';
import { encodeRings, type Point } from '../../../src/geo/quantise';
import type { DecodedSnapshot } from '../../../src/geo/snapshot';
import { buildMapData } from '../../../src/sim/map-data';
import { gridNetwork } from '../../fixtures/grid';

// Requirements W-3, W-5: the sim's map built from a snapshot.

function d(value: number): DerivedFigure {
  return { value, unit: 'count', tag: 'derived', sourceIds: ['kasaflow-assumptions'], asOf: '2026-10-14', derivedFrom: ['smartBins'] };
}

const SCALE: ClusterScale = {
  population2011: d(4_000),
  population2026: d(6_400),
  households: d(1_641),
  perCapitaKgPerDay: d(0.39),
  wasteTpd: d(2.5),
  autoTippers: d(2),
  compactors: d(1),
  blackSpots: d(3),
};

/** 8 × 8 grid of 80 m blocks, one 10 × 12 m house in every block (more floors in the north), KCDC and 2 markets. */
function snapshot(): DecodedSnapshot {
  const roads = gridNetwork(8, 8, 80);
  const rings: Point[][] = [];
  const levels: number[] = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const x = c * 80 + 30;
      const y = r * 80 + 30;
      rings.push([[x, y], [x + 10, y], [x + 10, y + 12], [x, y + 12], [x, y]]);
      levels.push(r < 4 ? 1 : 3);
    }
  }
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
      counts: { buildings: rings.length, roadNodes: roads.nodes.length, roadWays: roads.ways.length, areas: 0, pois: 3 },
      coverage: { buildingsWithLevelsPct: 100, sparseWards: [] },
      files: {
        'roads.bin': { sha256: '', bytes: 0 },
        'buildings.bin': { sha256: '', bytes: 0 },
        'areas.bin': { sha256: '', bytes: 0 },
        'wards.json': { sha256: '', bytes: 0 },
        'pois.json': { sha256: '', bytes: 0 },
      },
    },
    roads,
    buildings: { rings: encodeRings(rings), levels: Uint8Array.from(levels), heightDm: new Uint16Array(levels.length), kind: new Uint8Array(levels.length).fill(1) },
    areas: { rings: encodeRings([]), kind: new Uint8Array(0) },
    wards: [],
    pois: [
      { kind: 'kcdc', osmId: 287_327_441, name: 'KCDC', x: 555, y: 2 },
      { kind: 'marketplace', osmId: 1, name: 'Market A', x: 160, y: 162 },
      { kind: 'marketplace', osmId: 2, name: 'Market B', x: 400, y: 401 },
    ],
  };
}

const OPTIONS = { smartBins: 12, transferPoints: 3, seed: 9 };

describe('buildMapData', () => {
  it('spreads households so they sum exactly to the derived total', () => {
    const map = buildMapData(snapshot(), SCALE, OPTIONS);
    expect(map.segments.reduce((s, x) => s + x.households, 0)).toBe(1_641);
    for (const s of map.segments) {
      expect(Number.isInteger(s.households)).toBe(true);
      expect(s.households).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives more households to streets next to taller buildings', () => {
    const map = buildMapData(snapshot(), SCALE, OPTIONS);
    const g = map.graph;
    const midY = (s: (typeof map.segments)[number]): number => (g.nodeY[g.edgeFrom[s.edges[0]!]!]! + g.nodeY[g.edgeTo[s.edges[0]!]!]!) / 2;
    const north = map.segments.filter((s) => midY(s) > 360).reduce((a, s) => a + s.households, 0);
    const south = map.segments.filter((s) => midY(s) < 200).reduce((a, s) => a + s.households, 0);
    expect(north).toBeGreaterThan(south);
  });

  it('puts KCDC at the graph node nearest the KCDC POI', () => {
    const map = buildMapData(snapshot(), SCALE, OPTIONS);
    const k = map.facilities.kcdcNode;
    expect([map.graph.nodeX[k], map.graph.nodeY[k]]).toEqual([560, 0]);
  });

  it('creates exactly the requested transfer points and bins on distinct valid nodes', () => {
    const map = buildMapData(snapshot(), SCALE, OPTIONS);
    const tp = map.facilities.transferPoints.map((t) => t.node);
    expect(tp).toHaveLength(3);
    expect(new Set(tp).size).toBe(3);
    expect(map.bins).toHaveLength(12);
    expect(map.bins.map((b) => b.id)).toEqual([...Array(12).keys()]);
    for (const n of [...tp, ...map.bins.map((b) => b.node), map.facilities.depotNode, map.facilities.dwccNode, map.facilities.landfill.exitNode]) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(map.graph.nodeCount);
    }
  });

  it('places market bins near the marketplaces first', () => {
    const map = buildMapData(snapshot(), SCALE, OPTIONS);
    const markets = map.bins.filter((b) => b.kind === 'market');
    expect(markets.length).toBeGreaterThanOrEqual(2);
    const near = (x: number, y: number): boolean => markets.some((b) => Math.hypot(map.graph.nodeX[b.node]! - x, map.graph.nodeY[b.node]! - y) <= 120);
    expect(near(160, 162)).toBe(true);
    expect(near(400, 401)).toBe(true);
    for (const b of map.bins) {
      expect(b.capacityKg).toBeGreaterThan(0);
      expect(b.dailyKg).toBeGreaterThan(0);
    }
  });

  it('creates the derived number of black spots, each on at least one segment', () => {
    const map = buildMapData(snapshot(), SCALE, OPTIONS);
    expect(map.blackSpots).toHaveLength(3);
    for (const b of map.blackSpots) {
      expect(b.segmentIds.length).toBeGreaterThan(0);
      for (const id of b.segmentIds) expect(map.segments[id]).toBeDefined();
    }
  });

  it('is deterministic for a seed', () => {
    expect(buildMapData(snapshot(), SCALE, OPTIONS)).toEqual(buildMapData(snapshot(), SCALE, OPTIONS));
  });
});
