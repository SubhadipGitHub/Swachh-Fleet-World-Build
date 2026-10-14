import type { Point } from '../../../src/geo/quantise';

function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker on pts[first..last], marking kept indices. */
function dp(pts: readonly Point[], first: number, last: number, tol: number, keep: boolean[]): void {
  let maxD = -1;
  let idx = -1;
  for (let i = first + 1; i < last; i++) {
    const d = segmentDistance(pts[i]!, pts[first]!, pts[last]!);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (idx >= 0 && maxD > tol) {
    keep[idx] = true;
    dp(pts, first, idx, tol, keep);
    dp(pts, idx, last, tol, keep);
  }
}

/**
 * Douglas–Peucker simplification of a closed ring (first point equals last). Every removed point lies within
 * `toleranceM` of the simplified ring, the result stays closed, and it keeps at least 4 points (a triangle plus the
 * closing point). Throws RangeError if the ring is not closed or has fewer than 4 points.
 */
export function simplifyRing(ring: readonly Point[], toleranceM: number): Point[] {
  if (ring.length < 4) throw new RangeError('A closed ring needs at least 4 points');
  const a = ring[0]!;
  const z = ring[ring.length - 1]!;
  if (a[0] !== z[0] || a[1] !== z[1]) throw new RangeError('Ring is not closed');

  // Split at the vertex farthest from the first, so both halves are open polylines.
  const last = ring.length - 1;
  let far = 1;
  let farD = -1;
  for (let i = 1; i < last; i++) {
    const d = Math.hypot(ring[i]![0] - a[0], ring[i]![1] - a[1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = keep[far] = keep[last] = true;
  dp(ring, 0, far, toleranceM, keep);
  dp(ring, far, last, toleranceM, keep);

  // Guarantee a triangle: add the vertex farthest from the chord if only two distinct points survived.
  if (keep.filter(Boolean).length < 4) {
    let best = -1;
    let bestD = -1;
    for (let i = 1; i < last; i++) {
      if (keep[i]) continue;
      const d = segmentDistance(ring[i]!, a, ring[far]!);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) keep[best] = true;
  }
  return ring.filter((_, i) => keep[i]);
}

/** Shoelace area of a closed ring, always positive (m²). */
export function ringArea(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return Math.abs(s) / 2;
}
