import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QUANT_MAX_ABS_M, QUANT_STEP_M, base64ToBytes, bytesToBase64, decodeRings, encodeRings, type Point } from '../../../src/geo/quantise';

// Architecture AD-3: 0.25 m Int16 quantisation with per-ring delta encoding.

const coord = fc.double({ min: -4000, max: 4000, noNaN: true });
const point = fc.tuple(coord, coord);
const ring = fc.array(point, { minLength: 1, maxLength: 30 });

describe('encodeRings / decodeRings', () => {
  it('round-trips within half a quantisation step', () => {
    fc.assert(
      fc.property(fc.array(ring, { maxLength: 10 }), (rings) => {
        const decoded = decodeRings(encodeRings(rings));
        expect(decoded.length).toBe(rings.length);
        rings.forEach((r, i) => {
          expect(decoded[i]!.length).toBe(r.length);
          r.forEach(([x, y], j) => {
            expect(Math.abs(decoded[i]![j]![0] - x)).toBeLessThanOrEqual(QUANT_STEP_M / 2 + 1e-9);
            expect(Math.abs(decoded[i]![j]![1] - y)).toBeLessThanOrEqual(QUANT_STEP_M / 2 + 1e-9);
          });
        });
      }),
    );
  });

  it('records ring starts with a final entry equal to the vertex count', () => {
    const enc = encodeRings([
      [[0, 0], [1, 0], [1, 1]],
      [[5, 5], [6, 6]],
    ]);
    expect([...enc.starts]).toEqual([0, 3, 5]);
    expect(enc.coords.length).toBe(10);
  });

  it('stores the first vertex absolute and the rest as deltas, in quarter metres', () => {
    const enc = encodeRings([[[10, -2], [10.5, -2], [10.5, -1.25]]]);
    expect([...enc.coords]).toEqual([40, -8, 2, 0, 0, 3]);
  });

  it('handles no rings', () => {
    const enc = encodeRings([]);
    expect([...enc.starts]).toEqual([0]);
    expect(decodeRings(enc)).toEqual([]);
  });

  it('rejects coordinates beyond the Int16 range', () => {
    expect(() => encodeRings([[[QUANT_MAX_ABS_M + 1, 0]]])).toThrow(RangeError);
    expect(() => encodeRings([[[0, -QUANT_MAX_ABS_M - 1]]])).toThrow(RangeError);
  });

  it('rejects a delta that does not fit in Int16', () => {
    const far: Point[] = [
      [-8000, 0],
      [8000, 0],
    ];
    expect(() => encodeRings([far])).toThrow(RangeError);
  });

  it('rejects NaN and infinite coordinates', () => {
    expect(() => encodeRings([[[Number.NaN, 0]]])).toThrow(RangeError);
    expect(() => encodeRings([[[0, Number.POSITIVE_INFINITY]]])).toThrow(RangeError);
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
      }),
    );
  });

  it('matches the standard alphabet with padding', () => {
    expect(bytesToBase64(new TextEncoder().encode('KasaFlow'))).toBe('S2FzYUZsb3c=');
    expect(new TextDecoder().decode(base64ToBytes('S2FzYUZsb3c='))).toBe('KasaFlow');
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base64ToBytes('S2F*YQ==')).toThrow(SyntaxError);
  });
});
