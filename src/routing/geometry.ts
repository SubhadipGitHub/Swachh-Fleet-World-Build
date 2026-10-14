import type { RoadGraph } from './graph';

export interface PointOnEdge {
  readonly x: number;
  readonly y: number;
  /** Radians, counter-clockwise from east (atan2 of the direction of travel). */
  readonly heading: number;
}

/** The point `s` metres along an edge's polyline (clamped to the ends), with its direction of travel. */
export function pointAlongEdge(g: RoadGraph, edge: number, s: number): PointOnEdge {
  const a = g.shapeStart[edge]!;
  const b = g.shapeStart[edge + 1]!;
  let left = Math.max(0, s);
  for (let k = a; k + 1 < b; k++) {
    const x0 = g.shapeXY[2 * k]!;
    const y0 = g.shapeXY[2 * k + 1]!;
    const x1 = g.shapeXY[2 * k + 2]!;
    const y1 = g.shapeXY[2 * k + 3]!;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (left <= seg || k + 2 === b) {
      const f = seg === 0 ? 0 : Math.min(1, left / seg);
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, heading: Math.atan2(y1 - y0, x1 - x0) };
    }
    left -= seg;
  }
  return { x: g.nodeX[g.edgeFrom[edge]!]!, y: g.nodeY[g.edgeFrom[edge]!]!, heading: 0 };
}
