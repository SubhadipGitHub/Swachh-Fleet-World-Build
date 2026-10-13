import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromThree, toThree } from '../../../src/render/coords';

// Architecture AD-4: local metres (x east, y north) map to Three.js (x, height, −y) with y up.

describe('toThree / fromThree', () => {
  it('maps east to +x, north to −z and height to +y', () => {
    expect(toThree(10, 20, 3)).toEqual({ x: 10, y: 3, z: -20 });
    expect(toThree(-5, -7)).toEqual({ x: -5, y: 0, z: 7 });
  });

  it('round-trips', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.double({ min: -1e4, max: 1e4, noNaN: true }), (x, y) => {
        const back = fromThree(toThree(x, y, 12));
        expect(back.x).toBe(x);
        expect(back.y + 0).toBe(y + 0);
      }),
    );
  });
});
