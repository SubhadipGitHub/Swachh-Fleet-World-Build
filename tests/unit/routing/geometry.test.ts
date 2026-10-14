import { describe, expect, it } from 'vitest';
import { buildGraph, nodeIndex, type RoadGraph } from '../../../src/routing/graph';
import { pointAlongEdge } from '../../../src/routing/geometry';

// Placing vehicles along an edge's polyline (render and world views).

/** An L-shaped way: 1 (0,0) → shape (30,0) → 3 (30,40), 70 m long. */
function lRoad(): { g: RoadGraph; edge: number } {
  const g = buildGraph({
    nodes: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 30, y: 0 },
      { id: 3, x: 30, y: 40 },
    ],
    ways: [{ id: 9, nodes: [1, 2, 3], highway: 'residential', oneway: 'yes' }],
  });
  const a = nodeIndex(g, 1);
  return { g, edge: g.firstOut[a]! };
}

describe('pointAlongEdge', () => {
  it('walks the polyline and reports the heading of the current piece', () => {
    const { g, edge } = lRoad();
    expect(pointAlongEdge(g, edge, 10)).toEqual({ x: 10, y: 0, heading: 0 });
    const p = pointAlongEdge(g, edge, 50);
    expect(p.x).toBeCloseTo(30, 9);
    expect(p.y).toBeCloseTo(20, 9);
    expect(p.heading).toBeCloseTo(Math.PI / 2, 9);
  });

  it('clamps to the ends', () => {
    const { g, edge } = lRoad();
    expect(pointAlongEdge(g, edge, -5)).toMatchObject({ x: 0, y: 0 });
    const end = pointAlongEdge(g, edge, 500);
    expect(end.x).toBeCloseTo(30, 9);
    expect(end.y).toBeCloseTo(40, 9);
  });
});
