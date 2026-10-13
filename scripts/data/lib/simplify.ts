import { notImplemented } from '../../../src/shared/not-implemented';
import type { Point } from '../../../src/geo/quantise';

/**
 * Douglas–Peucker simplification of a closed ring (first point equals last). Every removed point lies within
 * `toleranceM` of the simplified ring, the result stays closed, and it keeps at least 4 points (a triangle plus the
 * closing point). Throws RangeError if the ring is not closed or has fewer than 4 points.
 */
export function simplifyRing(ring: readonly Point[], toleranceM: number): Point[] {
  return notImplemented('simplifyRing', ring, toleranceM);
}

/** Shoelace area of a closed ring, always positive (m²). */
export function ringArea(ring: readonly Point[]): number {
  return notImplemented('ringArea', ring);
}
