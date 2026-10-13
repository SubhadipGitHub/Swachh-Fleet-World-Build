import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../../src/geo/quantise';
import { ringArea, simplifyRing } from '../../../scripts/data/lib/simplify';

// Architecture AD-3: Douglas–Peucker footprint simplification at 0.5 m.

function segDist([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToRing(p: Point, ring: readonly Point[]): number {
  let d = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) d = Math.min(d, segDist(p, ring[i]!, ring[i + 1]!));
  return d;
}

/** Star-shaped closed rings (always simple) with 4–40 vertices. */
const starRing = fc.array(fc.double({ min: 5, max: 30, noNaN: true }), { minLength: 3, maxLength: 39 }).map((radii) => {
  const pts: Point[] = radii.map((r, i) => {
    const a = (2 * Math.PI * i) / radii.length;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  return [...pts, pts[0]!];
});

describe('simplifyRing', () => {
  it('removes collinear points', () => {
    const square: Point[] = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(simplifyRing(square, 0.5)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  });

  it('keeps the ring closed, at least 4 points, and every removed point within tolerance', () => {
    fc.assert(
      fc.property(starRing, fc.double({ min: 0.1, max: 5, noNaN: true }), (ring, tol) => {
        const out = simplifyRing(ring, tol);
        expect(out[0]).toEqual(out[out.length - 1]);
        expect(out.length).toBeGreaterThanOrEqual(4);
        expect(out.length).toBeLessThanOrEqual(ring.length);
        for (const p of ring) expect(distToRing(p, out)).toBeLessThanOrEqual(tol + 1e-9);
        for (const p of out) expect(ring).toContainEqual(p);
      }),
    );
  });

  it('rejects open rings and rings with fewer than 4 points', () => {
    expect(() => simplifyRing([[0, 0], [1, 0], [1, 1], [0, 1]], 0.5)).toThrow(RangeError);
    expect(() => simplifyRing([[0, 0], [1, 0], [0, 0]], 0.5)).toThrow(RangeError);
  });
});

describe('ringArea', () => {
  it('is the absolute shoelace area', () => {
    expect(ringArea([[0, 0], [10, 0], [10, 12], [0, 12], [0, 0]])).toBe(120);
    expect(ringArea([[0, 0], [0, 12], [10, 12], [10, 0], [0, 0]])).toBe(120);
  });
});
