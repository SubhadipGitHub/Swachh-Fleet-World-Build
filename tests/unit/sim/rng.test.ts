import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STREAM_NAMES, createStreams, rngFromSeed, rngFromState } from '../../../src/sim/rng';

// Architecture AD-5: seeded xoshiro128** with independent named streams.

describe('xoshiro128**', () => {
  it('matches the reference output sequence for state [1, 2, 3, 4]', () => {
    // Reference values from the published algorithm (Blackman & Vigna), recomputed independently in Python.
    const r = rngFromState([1, 2, 3, 4]);
    expect(Array.from({ length: 8 }, () => r.nextU32())).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849]);
  });

  it('rejects the all-zero state', () => {
    expect(() => rngFromState([0, 0, 0, 0])).toThrow(RangeError);
  });

  it('returns 32-bit unsigned integers and next() in [0, 1)', () => {
    const r = rngFromSeed(42);
    for (let i = 0; i < 10_000; i++) {
      const u = r.nextU32();
      expect(Number.isInteger(u) && u >= 0 && u < 2 ** 32).toBe(true);
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  it('reproduces the same sequence for the same seed, and a different one for another seed', () => {
    fc.assert(
      fc.property(fc.nat({ max: 2 ** 32 - 1 }), (seed) => {
        const a = rngFromSeed(seed);
        const b = rngFromSeed(seed);
        const c = rngFromSeed((seed + 1) >>> 0);
        const sa = Array.from({ length: 16 }, () => a.nextU32());
        expect(Array.from({ length: 16 }, () => b.nextU32())).toEqual(sa);
        expect(Array.from({ length: 16 }, () => c.nextU32())).not.toEqual(sa);
      }),
    );
  });

  it('seed 0 still produces a non-zero state', () => {
    expect(rngFromSeed(0).state().some((w) => w !== 0)).toBe(true);
  });

  it('can resume from a saved state', () => {
    const a = rngFromSeed(7);
    for (let i = 0; i < 100; i++) a.nextU32();
    const b = rngFromState(a.state());
    expect(Array.from({ length: 10 }, () => b.nextU32())).toEqual(Array.from({ length: 10 }, () => a.nextU32()));
  });

  it('int() is inclusive at both ends and hits every value', () => {
    const r = rngFromSeed(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const v = r.int(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
    expect(() => r.int(5, 4)).toThrow(RangeError);
    expect(() => r.int(0.5, 4)).toThrow(RangeError);
  });

  it('chance() honours 0 and 1 and approximates p', () => {
    const r = rngFromSeed(11);
    expect(Array.from({ length: 1000 }, () => r.chance(0)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 1000 }, () => r.chance(1)).every(Boolean)).toBe(true);
    const hits = Array.from({ length: 100_000 }, () => r.chance(0.05)).filter(Boolean).length;
    expect(hits / 100_000).toBeCloseTo(0.05, 2);
  });

  it('normal() has roughly the requested mean and standard deviation', () => {
    const r = rngFromSeed(5);
    const xs = Array.from({ length: 50_000 }, () => r.normal(10, 2));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(10, 1);
    expect(sd).toBeCloseTo(2, 1);
  });

  it('passes a chi-square uniformity smoke test (10 bins, 100k draws, p > 0.001)', () => {
    const r = rngFromSeed(2026);
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < 100_000; i++) bins[Math.floor(r.next() * 10)]!++;
    const chi2 = bins.reduce((s, o) => s + (o - 10_000) ** 2 / 10_000, 0);
    expect(chi2).toBeLessThan(27.88); // 9 degrees of freedom, p = 0.001
  });
});

describe('createStreams', () => {
  it('has one generator per stream name', () => {
    expect(Object.keys(createStreams(1)).sort()).toEqual([...STREAM_NAMES].sort());
  });

  it('gives different sequences to different streams', () => {
    const s = createStreams(99);
    const firsts = STREAM_NAMES.map((n) => s[n].nextU32());
    expect(new Set(firsts).size).toBe(STREAM_NAMES.length);
  });

  it('keeps streams independent: drawing from one never shifts another', () => {
    const a = createStreams(123);
    const b = createStreams(123);
    for (let i = 0; i < 500; i++) a.sensors.nextU32();
    expect(Array.from({ length: 20 }, () => a.absence.nextU32())).toEqual(Array.from({ length: 20 }, () => b.absence.nextU32()));
  });

  it('is reproducible for a run seed', () => {
    const a = createStreams(77);
    const b = createStreams(77);
    for (const n of STREAM_NAMES) expect(a[n].state()).toEqual(b[n].state());
  });
});
