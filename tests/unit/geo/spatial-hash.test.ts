import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../../../src/geo/spatial-hash';

// Architecture AD-10: picking and proximity via a uniform grid. Checked against brute force.

const pts = fc.uniqueArray(
  fc.record({ id: fc.nat({ max: 10_000 }), x: fc.double({ min: -500, max: 500, noNaN: true }), y: fc.double({ min: -500, max: 500, noNaN: true }) }),
  { selector: (p) => p.id, maxLength: 80 },
);
const query = fc.record({ x: fc.double({ min: -600, max: 600, noNaN: true }), y: fc.double({ min: -600, max: 600, noNaN: true }), r: fc.double({ min: 0, max: 300, noNaN: true }) });

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

describe('SpatialHash', () => {
  it('rejects a non-positive cell size', () => {
    expect(() => new SpatialHash(0)).toThrow(RangeError);
  });

  it('queryRadius equals brute force, in ascending id order', () => {
    fc.assert(
      fc.property(pts, query, fc.double({ min: 5, max: 200, noNaN: true }), (points, q, cell) => {
        const h = new SpatialHash(cell);
        for (const p of points) h.insert(p.id, p.x, p.y);
        const expected = points.filter((p) => dist(p.x, p.y, q.x, q.y) <= q.r).map((p) => p.id).sort((a, b) => a - b);
        expect(h.queryRadius(q.x, q.y, q.r)).toEqual(expected);
      }),
    );
  });

  it('nearest equals brute force, lowest id on ties', () => {
    fc.assert(
      fc.property(pts, query, (points, q) => {
        const h = new SpatialHash(50);
        for (const p of points) h.insert(p.id, p.x, p.y);
        let best: { id: number; d: number } | null = null;
        for (const p of points) {
          const d = dist(p.x, p.y, q.x, q.y);
          if (d > q.r) continue;
          if (!best || d < best.d || (d === best.d && p.id < best.id)) best = { id: p.id, d };
        }
        expect(h.nearest(q.x, q.y, q.r)).toBe(best?.id ?? null);
      }),
    );
  });

  it('move and remove keep queries correct', () => {
    const h = new SpatialHash(10);
    h.insert(1, 0, 0);
    h.insert(2, 100, 100);
    expect(h.size).toBe(2);
    h.move(1, 95, 95);
    expect(h.queryRadius(100, 100, 10)).toEqual([1, 2]);
    expect(h.queryRadius(0, 0, 10)).toEqual([]);
    expect(h.remove(2)).toBe(true);
    expect(h.remove(2)).toBe(false);
    expect(h.size).toBe(1);
    expect(h.nearest(100, 100, 50)).toBe(1);
  });

  it('rejects duplicate inserts and moves of unknown ids', () => {
    const h = new SpatialHash(10);
    h.insert(7, 0, 0);
    expect(() => h.insert(7, 1, 1)).toThrow();
    expect(() => h.move(8, 1, 1)).toThrow();
  });
});
