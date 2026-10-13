import { describe, expect, it } from 'vitest';
import { buildGraph, nodeIndex, type RoadGraph } from '../../../src/routing/graph';
import { shortestPath, shortestPathTree } from '../../../src/routing/dijkstra';
import { gridNetwork, gridNodeId } from '../../fixtures/grid';

// Edge cases the property tests do not pin down.

describe('shortestPath edge cases', () => {
  /** Built per test so a stubbed graph builder fails each test individually. */
  const setup = (): { g: RoadGraph; len: (e: number) => number } => {
    const g = buildGraph(gridNetwork(3, 3, 100));
    return { g, len: (e) => g.edgeLengthM[e]! };
  };

  it('a path to itself costs 0 and has no edges', () => {
    const { g, len } = setup();
    expect(shortestPath(g, 4, 4, len)).toEqual({ cost: 0, edges: [], nodes: [4] });
  });

  it('never uses an edge of infinite cost', () => {
    const { g, len } = setup();
    const a = nodeIndex(g, gridNodeId(3, 0, 0));
    const b = nodeIndex(g, gridNodeId(3, 1, 0));
    const blocked = new Set<number>();
    for (let e = 0; e < g.edgeCount; e++) if (g.edgeFrom[e] === a && g.edgeTo[e] === b) blocked.add(e);
    const p = shortestPath(g, a, b, (e) => (blocked.has(e) ? Infinity : len(e)));
    expect(p).not.toBeNull();
    expect(p!.cost).toBeCloseTo(300, 9);
    for (const e of p!.edges) expect(blocked.has(e)).toBe(false);
  });

  it('returns null when every route is closed', () => {
    const { g } = setup();
    expect(shortestPath(g, 0, 8, () => Infinity)).toBeNull();
  });

  it('rejects negative edge costs', () => {
    const { g } = setup();
    expect(() => shortestPathTree(g, 0, () => -1)).toThrow(RangeError);
  });

  it('marks the source and unreachable nodes with prevEdge −1', () => {
    const { g } = setup();
    const tree = shortestPathTree(g, 0, () => Infinity);
    expect(tree.prevEdge[0]).toBe(-1);
    expect(tree.dist[0]).toBe(0);
    expect(tree.prevEdge[8]).toBe(-1);
    expect(tree.dist[8]).toBe(Infinity);
  });
});
