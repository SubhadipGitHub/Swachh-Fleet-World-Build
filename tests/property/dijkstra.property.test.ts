import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RoadNetworkInput } from '../../src/geo/snapshot';
import { buildGraph, type RoadGraph } from '../../src/routing/graph';
import { pathFromTree, shortestPath, shortestPathTree, straightLineHeuristic } from '../../src/routing/dijkstra';

// Architecture AD-7: Dijkstra and A* agree with Floyd–Warshall on random road graphs.

/** Random graphs: up to 12 nodes on a 1 km square, up to 30 two-node ways, some one-way. */
const network: fc.Arbitrary<RoadNetworkInput> = fc
  .integer({ min: 2, max: 12 })
  .chain((n) =>
    fc.record({
      coords: fc.array(fc.tuple(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 })), { minLength: n, maxLength: n }),
      ways: fc.array(fc.tuple(fc.integer({ min: 0, max: n - 1 }), fc.integer({ min: 0, max: n - 1 }), fc.constantFrom<'no' | 'yes'>('no', 'no', 'yes')), { minLength: 1, maxLength: 30 }),
    }),
  )
  .map(({ coords, ways }) => ({
    nodes: coords.map(([x, y], i) => ({ id: i + 1, x, y: y + i * 1e-3 })),
    ways: ways.filter(([a, b]) => a !== b).map(([a, b, oneway], i) => ({ id: 100 + i, nodes: [a + 1, b + 1], highway: 'residential' as const, oneway })),
  }))
  .filter((net) => net.ways.length > 0);

function floydWarshall(g: RoadGraph): number[][] {
  const n = g.nodeCount;
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  for (let e = 0; e < g.edgeCount; e++) {
    const a = g.edgeFrom[e]!;
    const b = g.edgeTo[e]!;
    d[a]![b] = Math.min(d[a]![b]!, g.edgeLengthM[e]!);
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i]![j] = Math.min(d[i]![j]!, d[i]![k]! + d[k]![j]!);
  return d;
}

const byLength = (g: RoadGraph) => (e: number): number => g.edgeLengthM[e]!;

describe('shortest paths', () => {
  it('shortestPathTree distances equal Floyd–Warshall', () => {
    fc.assert(
      fc.property(network, (net) => {
        const g = buildGraph(net);
        const ref = floydWarshall(g);
        for (let s = 0; s < g.nodeCount; s++) {
          const tree = shortestPathTree(g, s, byLength(g));
          for (let t = 0; t < g.nodeCount; t++) {
            if (ref[s]![t] === Infinity) expect(tree.dist[t]).toBe(Infinity);
            else expect(tree.dist[t]).toBeCloseTo(ref[s]![t]!, 6);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('paths are connected, start and end correctly, and cost what they say', () => {
    fc.assert(
      fc.property(network, fc.nat(), fc.nat(), (net, si, ti) => {
        const g = buildGraph(net);
        const s = si % g.nodeCount;
        const t = ti % g.nodeCount;
        const p = shortestPath(g, s, t, byLength(g));
        const ref = floydWarshall(g)[s]![t]!;
        if (ref === Infinity) {
          expect(p).toBeNull();
          return;
        }
        expect(p).not.toBeNull();
        expect(p!.nodes[0]).toBe(s);
        expect(p!.nodes[p!.nodes.length - 1]).toBe(t);
        expect(p!.nodes.length).toBe(p!.edges.length + 1);
        p!.edges.forEach((e, i) => {
          expect(g.edgeFrom[e]).toBe(p!.nodes[i]);
          expect(g.edgeTo[e]).toBe(p!.nodes[i + 1]);
        });
        expect(p!.cost).toBeCloseTo(p!.edges.reduce((sum, e) => sum + g.edgeLengthM[e]!, 0), 6);
        expect(p!.cost).toBeCloseTo(ref, 6);
      }),
      { numRuns: 200 },
    );
  });

  it('A* with the straight-line heuristic finds the same cost as Dijkstra', () => {
    fc.assert(
      fc.property(network, fc.nat(), fc.nat(), (net, si, ti) => {
        const g = buildGraph(net);
        const s = si % g.nodeCount;
        const t = ti % g.nodeCount;
        const timeCost = (e: number): number => g.edgeLengthM[e]! / g.edgeFreeSpeedMps[e]!;
        const maxSpeed = Math.max(...g.edgeFreeSpeedMps);
        const d = shortestPath(g, s, t, timeCost);
        const a = shortestPath(g, s, t, timeCost, straightLineHeuristic(g, t, maxSpeed));
        if (d === null) {
          expect(a).toBeNull();
        } else {
          expect(a).not.toBeNull();
          expect(a!.cost).toBeCloseTo(d.cost, 6);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('pathFromTree agrees with shortestPath', () => {
    fc.assert(
      fc.property(network, (net) => {
        const g = buildGraph(net);
        const tree = shortestPathTree(g, 0, byLength(g));
        for (let t = 0; t < g.nodeCount; t++) {
          const fromTree = pathFromTree(g, tree, t);
          const direct = shortestPath(g, 0, t, byLength(g));
          if (direct === null) {
            expect(fromTree).toBeNull();
          } else {
            expect(fromTree).not.toBeNull();
            expect(fromTree!.cost).toBeCloseTo(direct.cost, 6);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic: the same inputs give the same path', () => {
    fc.assert(
      fc.property(network, (net) => {
        const g = buildGraph(net);
        const last = g.nodeCount - 1;
        expect(shortestPath(g, 0, last, byLength(g))).toEqual(shortestPath(g, 0, last, byLength(g)));
      }),
    );
  });
});
