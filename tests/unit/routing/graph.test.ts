import { describe, expect, it } from 'vitest';
import { HIGHWAY_CLASSES, type RoadNetworkInput } from '../../../src/geo/snapshot';
import { DEFAULT_FREE_SPEED_KMH, buildGraph, nodeIndex, type RoadGraph } from '../../../src/routing/graph';
import { gridNetwork } from '../../fixtures/grid';

// Architecture AD-7: CSR road graph built from OSM-style ways.

/** A "+" crossing: way 10 runs 1–2–3 west to east, way 20 runs 4–2–5 south to north, all two-way. */
const PLUS: RoadNetworkInput = {
  nodes: [
    { id: 1, x: -100, y: 0 },
    { id: 2, x: 0, y: 0 },
    { id: 3, x: 100, y: 0 },
    { id: 4, x: 0, y: -50 },
    { id: 5, x: 0, y: 50 },
  ],
  ways: [
    { id: 10, nodes: [1, 2, 3], highway: 'secondary', oneway: 'no' },
    { id: 20, nodes: [4, 2, 5], highway: 'residential', oneway: 'no' },
  ],
};

function outEdges(g: RoadGraph, node: number): number[] {
  const out: number[] = [];
  for (let e = g.firstOut[node]!; e < g.firstOut[node + 1]!; e++) out.push(e);
  return out;
}

function edgeBetween(g: RoadGraph, fromOsm: number, toOsm: number): number[] {
  const a = nodeIndex(g, fromOsm);
  const b = nodeIndex(g, toOsm);
  return outEdges(g, a).filter((e) => g.edgeTo[e] === b);
}

describe('buildGraph', () => {
  it('splits ways at shared nodes: the plus gives 5 nodes and 8 directed edges', () => {
    const g = buildGraph(PLUS);
    expect(g.nodeCount).toBe(5);
    expect(g.edgeCount).toBe(8);
  });

  it('assigns node indices in ascending OSM id order', () => {
    const g = buildGraph(PLUS);
    expect([...g.nodeOsmId]).toEqual([1, 2, 3, 4, 5]);
    expect(nodeIndex(g, 4)).toBe(3);
    expect(nodeIndex(g, 99)).toBe(-1);
  });

  it('is a valid CSR: firstOut is non-decreasing and every out-edge starts at its node', () => {
    const g = buildGraph(gridNetwork(4, 3, 50));
    expect(g.firstOut.length).toBe(g.nodeCount + 1);
    expect(g.firstOut[0]).toBe(0);
    expect(g.firstOut[g.nodeCount]).toBe(g.edgeCount);
    for (let n = 0; n < g.nodeCount; n++) {
      expect(g.firstOut[n + 1]!).toBeGreaterThanOrEqual(g.firstOut[n]!);
      for (const e of outEdges(g, n)) expect(g.edgeFrom[e]).toBe(n);
    }
  });

  it('keeps shape points of a way that pass no junction as geometry, not nodes', () => {
    const g = buildGraph({
      nodes: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 30, y: 40 },
        { id: 3, x: 60, y: 0 },
      ],
      ways: [{ id: 7, nodes: [1, 2, 3], highway: 'residential', oneway: 'no' }],
    });
    expect(g.nodeCount).toBe(2);
    expect(g.edgeCount).toBe(2);
    const [e] = edgeBetween(g, 1, 3);
    expect(g.edgeLengthM[e!]).toBeCloseTo(100, 9);
    const shape = [...g.shapeXY.slice(2 * g.shapeStart[e!]!, 2 * g.shapeStart[e! + 1]!)];
    expect(shape).toEqual([0, 0, 30, 40, 60, 0]);
    const [r] = edgeBetween(g, 3, 1);
    expect([...g.shapeXY.slice(2 * g.shapeStart[r!]!, 2 * g.shapeStart[r! + 1]!)]).toEqual([60, 0, 30, 40, 0, 0]);
  });

  it('respects oneway=yes and oneway=-1', () => {
    const net: RoadNetworkInput = {
      nodes: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
        { id: 3, x: 200, y: 0 },
      ],
      ways: [
        { id: 1, nodes: [1, 2], highway: 'tertiary', oneway: 'yes' },
        { id: 2, nodes: [2, 3], highway: 'tertiary', oneway: '-1' },
      ],
    };
    const g = buildGraph(net);
    expect(edgeBetween(g, 1, 2)).toHaveLength(1);
    expect(edgeBetween(g, 2, 1)).toHaveLength(0);
    expect(edgeBetween(g, 3, 2)).toHaveLength(1);
    expect(edgeBetween(g, 2, 3)).toHaveLength(0);
    expect(g.edgeTwin[edgeBetween(g, 1, 2)[0]!]).toBe(-1);
  });

  it('pairs the two directions of a two-way street as twins', () => {
    const g = buildGraph(PLUS);
    for (let e = 0; e < g.edgeCount; e++) {
      const t = g.edgeTwin[e]!;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(g.edgeTwin[t]).toBe(e);
      expect(g.edgeFrom[t]).toBe(g.edgeTo[e]);
      expect(g.edgeTo[t]).toBe(g.edgeFrom[e]);
    }
  });

  it('stores class, way id, default free speed, and maxspeed where tagged', () => {
    const g = buildGraph({
      ...PLUS,
      ways: [PLUS.ways[0]!, { ...PLUS.ways[1]!, maxspeedKmh: 36 }],
    });
    const [sec] = edgeBetween(g, 1, 2);
    expect(HIGHWAY_CLASSES[g.edgeClass[sec!]!]).toBe('secondary');
    expect(g.edgeWayId[sec!]).toBe(10);
    expect(g.edgeFreeSpeedMps[sec!]).toBeCloseTo(DEFAULT_FREE_SPEED_KMH.secondary / 3.6, 9);
    const [res] = edgeBetween(g, 4, 2);
    expect(g.edgeFreeSpeedMps[res!]).toBeCloseTo(10, 9);
  });

  it('gives one-way edges all lanes and each direction of a two-way street half (at least 1)', () => {
    const g = buildGraph({
      nodes: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 100, y: 0 },
        { id: 3, x: 200, y: 0 },
        { id: 4, x: 300, y: 0 },
      ],
      ways: [
        { id: 1, nodes: [1, 2], highway: 'primary', oneway: 'yes', lanes: 3 },
        { id: 2, nodes: [2, 3], highway: 'primary', oneway: 'no', lanes: 4 },
        { id: 3, nodes: [3, 4], highway: 'residential', oneway: 'no', lanes: 1 },
      ],
    });
    expect(g.edgeLanes[edgeBetween(g, 1, 2)[0]!]).toBe(3);
    expect(g.edgeLanes[edgeBetween(g, 2, 3)[0]!]).toBe(2);
    expect(g.edgeLanes[edgeBetween(g, 3, 4)[0]!]).toBe(1);
  });

  it('sorts edges by (from, to, way id)', () => {
    const g = buildGraph(gridNetwork(3, 3, 10));
    for (let e = 1; e < g.edgeCount; e++) {
      const a = [g.edgeFrom[e - 1]!, g.edgeTo[e - 1]!, g.edgeWayId[e - 1]!];
      const b = [g.edgeFrom[e]!, g.edgeTo[e]!, g.edgeWayId[e]!];
      expect(a[0]! < b[0]! || (a[0] === b[0] && (a[1]! < b[1]! || (a[1] === b[1] && a[2]! <= b[2]!)))).toBe(true);
    }
  });

  it('is deterministic', () => {
    const a = buildGraph(gridNetwork(5, 4, 37));
    const b = buildGraph(gridNetwork(5, 4, 37));
    expect(b).toEqual(a);
  });

  it('rejects a way that references a missing node, or has fewer than 2 nodes', () => {
    expect(() => buildGraph({ nodes: PLUS.nodes, ways: [{ id: 1, nodes: [1, 99], highway: 'service', oneway: 'no' }] })).toThrow(RangeError);
    expect(() => buildGraph({ nodes: PLUS.nodes, ways: [{ id: 1, nodes: [1], highway: 'service', oneway: 'no' }] })).toThrow(RangeError);
  });

  it('drops nodes no way uses', () => {
    const g = buildGraph({ nodes: [...PLUS.nodes, { id: 77, x: 5, y: 5 }], ways: PLUS.ways });
    expect(nodeIndex(g, 77)).toBe(-1);
  });
});
