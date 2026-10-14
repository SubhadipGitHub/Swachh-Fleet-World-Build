import { describe, expect, it } from 'vitest';
import { stitchRings } from '../../../scripts/data/lib/stitch';

// Multipolygon outer ways (lakes, parks) joined into closed rings.

const p = (lat: number, lon: number): { lat: number; lon: number } => ({ lat, lon });

describe('stitchRings', () => {
  it('joins parts that meet end to end, in either direction', () => {
    const rings = stitchRings([
      [p(0, 0), p(0, 1), p(1, 1)],
      [p(1, 0), p(1, 1)], // reversed relative to the first part
      [p(1, 0), p(0, 0)],
    ]);
    expect(rings).toHaveLength(1);
    const ring = rings[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(5);
  });

  it('keeps an already closed way and drops parts that never close', () => {
    const rings = stitchRings([
      [p(5, 5), p(5, 6), p(6, 6), p(5, 5)],
      [p(9, 9), p(9, 10)],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]![0]).toEqual(p(5, 5));
  });

  it('prepends parts that meet the head of the ring', () => {
    const rings = stitchRings([
      [p(0, 1), p(1, 1), p(1, 0)],
      [p(0, 0), p(0, 1)],
      [p(1, 0), p(0, 0)],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]![0]).toEqual(rings[0]![rings[0]!.length - 1]);
  });
});
