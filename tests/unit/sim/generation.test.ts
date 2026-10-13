import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DAY_SEC } from '../../../src/sim/clock';
import { accumulatedKg, defaultProfiles, normaliseProfile, profileRate, type DailyProfile } from '../../../src/sim/generation';

// Requirements L-1 step 1, architecture AD-5: waste accumulates lazily, in closed form.

const FLAT = (): DailyProfile => normaliseProfile([{ sec: 0, w: 1 }]);
const PEAKY = (): DailyProfile =>
  normaliseProfile([
    { sec: 0, w: 0.2 },
    { sec: 6 * 3600, w: 0.4 },
    { sec: 8 * 3600, w: 3 },
    { sec: 11 * 3600, w: 1 },
    { sec: 20 * 3600, w: 0.5 },
  ]);

/** Midpoint-rule integration at 1-second resolution, the reference the closed form must match. */
function stepwise(dailyKg: number, p: DailyProfile, from: number, to: number, factorAt: (t: number) => number = () => 1): number {
  let kg = 0;
  for (let t = from; t < to; t++) kg += dailyKg * profileRate(p, ((t % DAY_SEC) + DAY_SEC) % DAY_SEC + 0.5) * factorAt(t);
  return kg;
}

describe('normaliseProfile', () => {
  it('scales so one day integrates to 1', () => {
    expect(accumulatedKg(1, PEAKY(), 0, DAY_SEC)).toBeCloseTo(1, 9);
    expect(profileRate(FLAT(), 12_345)).toBeCloseTo(1 / DAY_SEC, 15);
  });

  it('rejects invalid knots', () => {
    expect(() => normaliseProfile([])).toThrow(RangeError);
    expect(() => normaliseProfile([{ sec: 10, w: 1 }])).toThrow(RangeError);
    expect(() => normaliseProfile([{ sec: 0, w: 1 }, { sec: 0, w: 2 }])).toThrow(RangeError);
    expect(() => normaliseProfile([{ sec: 0, w: 1 }, { sec: DAY_SEC, w: 2 }])).toThrow(RangeError);
    expect(() => normaliseProfile([{ sec: 0, w: -1 }, { sec: 10, w: 2 }])).toThrow(RangeError);
    expect(() => normaliseProfile([{ sec: 0, w: 0 }, { sec: 10, w: 0 }])).toThrow(RangeError);
  });

  it('interpolates linearly and wraps from the last knot to midnight', () => {
    const p = normaliseProfile([
      { sec: 0, w: 0 },
      { sec: 43_200, w: 2 },
    ]);
    expect(profileRate(p, 21_600) / profileRate(p, 43_200)).toBeCloseTo(0.5, 9);
    expect(profileRate(p, 64_800) / profileRate(p, 43_200)).toBeCloseTo(0.5, 9);
  });
});

describe('accumulatedKg', () => {
  it('gives the daily total over any 24 hours', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 * DAY_SEC }), (start) => {
        expect(accumulatedKg(250, PEAKY(), start, start + DAY_SEC)).toBeCloseTo(250, 6);
      }),
    );
  });

  it('is additive over adjacent intervals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 * DAY_SEC }), fc.integer({ min: 0, max: DAY_SEC }), fc.integer({ min: 0, max: DAY_SEC }), (a, d1, d2) => {
        const p = PEAKY();
        expect(accumulatedKg(80, p, a, a + d1) + accumulatedKg(80, p, a + d1, a + d1 + d2)).toBeCloseTo(accumulatedKg(80, p, a, a + d1 + d2), 6);
      }),
    );
  });

  it('equals step-wise integration at 1 s resolution', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 * DAY_SEC }), fc.integer({ min: 1, max: 20_000 }), (from, len) => {
        const p = PEAKY();
        const closed = accumulatedKg(500, p, from, from + len);
        expect(closed).toBeCloseTo(stepwise(500, p, from, from + len), 4);
      }),
      { numRuns: 60 },
    );
  });

  it('applies multiplier spans and treats time outside them as factor 1', () => {
    const p = PEAKY();
    const spans = [
      { from: 3600, to: 7200, factor: 2 },
      { from: 30_000, to: 40_000, factor: 1.15 },
    ];
    const factorAt = (t: number): number => spans.find((s) => t >= s.from && t < s.to)?.factor ?? 1;
    expect(accumulatedKg(300, p, 0, 50_000, spans)).toBeCloseTo(stepwise(300, p, 0, 50_000, factorAt), 4);
    expect(accumulatedKg(300, p, 0, DAY_SEC, [{ from: 0, to: DAY_SEC, factor: 2 }])).toBeCloseTo(600, 6);
  });

  it('is 0 for an empty interval and rejects a reversed one or overlapping spans', () => {
    expect(accumulatedKg(100, FLAT(), 500, 500)).toBe(0);
    expect(() => accumulatedKg(100, FLAT(), 500, 499)).toThrow(RangeError);
    expect(() =>
      accumulatedKg(100, FLAT(), 0, 10, [
        { from: 0, to: 6, factor: 2 },
        { from: 5, to: 9, factor: 3 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('defaultProfiles', () => {
  const peakHour = (p: DailyProfile): number => {
    let best = 0;
    for (let s = 0; s < DAY_SEC; s += 300) if (profileRate(p, s) > profileRate(p, best)) best = s;
    return best / 3600;
  };

  it('households peak in the morning (06:00–10:00)', () => {
    const h = peakHour(defaultProfiles().household);
    expect(h).toBeGreaterThanOrEqual(6);
    expect(h).toBeLessThan(10);
  });

  it('markets peak after market hours (17:00–23:00)', () => {
    const h = peakHour(defaultProfiles().market);
    expect(h).toBeGreaterThanOrEqual(17);
    expect(h).toBeLessThan(23);
  });

  it('both integrate to 1 over a day', () => {
    const { household, market } = defaultProfiles();
    expect(accumulatedKg(1, household, 0, DAY_SEC)).toBeCloseTo(1, 9);
    expect(accumulatedKg(1, market, 0, DAY_SEC)).toBeCloseTo(1, 9);
  });
});
