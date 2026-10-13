import { describe, expect, it } from 'vitest';
import { deltaVsTwin, fuelCostInr, fuelPerTonne, onTimeCoverage, overflowHoursIncrement, overflowingPoints } from '../../../src/sim/kpi';

// Requirements §6, K-1 to K-3, and D3 (deltas against the shadow twin).

describe('K-1 overflowing points', () => {
  it('counts bins at or above 100% and active or clearing black spots', () => {
    const r = overflowingPoints({
      bins: [{ trueFillPct: 99.9 }, { trueFillPct: 100 }, { trueFillPct: 130 }, { trueFillPct: 20 }],
      blackSpots: [{ kind: 'Dormant' }, { kind: 'Active', sizeKg: 10 }, { kind: 'Clearing', sizeKg: 4 }],
    });
    expect(r).toEqual({ total: 4, binsFull: 2, blackSpotsActive: 2 });
  });

  it('is zero for an empty world', () => {
    expect(overflowingPoints({ bins: [], blackSpots: [] })).toEqual({ total: 0, binsFull: 0, blackSpotsActive: 0 });
  });

  it('accumulates overflow-hours per step', () => {
    expect(overflowHoursIncrement([{ trueFillPct: 100 }, { trueFillPct: 120 }, { trueFillPct: 50 }], 1800)).toBeCloseTo(1, 12);
    expect(overflowHoursIncrement([], 60)).toBe(0);
  });
});

describe('K-2 fuel per tonne', () => {
  it('divides litres by tonnes delivered', () => {
    expect(fuelPerTonne(450, 90)).toBe(5);
  });

  it('is null before anything is delivered', () => {
    expect(fuelPerTonne(12, 0)).toBeNull();
  });

  it('prices diesel and CNG separately', () => {
    expect(fuelCostInr({ diesel: 100, cng: 20 }, { diesel: 90, cng: 80 })).toBe(10_600);
  });
});

describe('K-3 on-time coverage', () => {
  it('counts jobs served inside their window, inclusive at both ends', () => {
    const r = onTimeCoverage([
      { windowStart: 100, windowEnd: 200, servicedAt: 100 },
      { windowStart: 100, windowEnd: 200, servicedAt: 200 },
      { windowStart: 100, windowEnd: 200, servicedAt: 201 },
      { windowStart: 100, windowEnd: 200, servicedAt: 99 },
      { windowStart: 100, windowEnd: 200, servicedAt: null },
    ]);
    expect(r).toEqual({ pct: 40, onTime: 2, scheduled: 5 });
  });

  it('is null when nothing is scheduled', () => {
    expect(onTimeCoverage([])).toEqual({ pct: null, onTime: 0, scheduled: 0 });
  });
});

describe('delta against the shadow twin (D8)', () => {
  it('gives absolute and percentage differences', () => {
    expect(deltaVsTwin(80, 100)).toEqual({ abs: -20, pct: -20 });
    expect(deltaVsTwin(5, 4)).toEqual({ abs: 1, pct: 25 });
  });

  it('has no percentage when the twin is zero', () => {
    expect(deltaVsTwin(3, 0)).toEqual({ abs: 3, pct: null });
  });
});
