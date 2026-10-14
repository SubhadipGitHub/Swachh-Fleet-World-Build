import { describe, expect, it } from 'vitest';
import { CRITICAL_SPOT_KG, DEFAULT_CREW_WEIGHTS, HEATWAVE_RISK, NIGHT_WINDOW, mayDispatch, rankSpots, spotRisk, type SpotOutlook } from '../../../src/sim/policies/crews';
import { DEFAULT_DISPATCH, dispatchCompactors, urgencyAt, type FreeCompactor, type TransferPointOutlook } from '../../../src/sim/policies/dispatch';

// Requirements M3-6, M3-7 and architecture M3-D7, M3-D8.

/** A point whose container fills linearly from `pct` at t = 0 at `perHour` points an hour. */
const tp = (id: number, pct: number, perHour: number, tippersDue = 0): TransferPointOutlook => ({
  tp: id,
  predictPct: (at) => pct + (perHour * at) / 3600,
  tippersDue,
});
const compactor = (id: number, secs: readonly number[]): FreeCompactor => ({ id, travelSecTo: (t) => secs[t]! });

describe('urgencyAt', () => {
  it('is the forecast fill at arrival plus a tipper load per tipper due', () => {
    expect(urgencyAt(tp(0, 50, 10), 3600)).toBeCloseTo(60, 9);
    expect(urgencyAt(tp(0, 50, 10, 2), 3600)).toBeCloseTo(60 + 2 * DEFAULT_DISPATCH.pctPerTipper, 9);
  });
});

describe('dispatchCompactors', () => {
  it('sends nobody while every point stays under 80% at arrival', () => {
    expect(dispatchCompactors(0, [compactor(0, [600, 600])], [tp(0, 40, 10), tp(1, 70, 5)])).toEqual([]);
  });

  it('sends a compactor to a point forecast to reach 80% by the time it gets there', () => {
    // Point 1 is at 75% now and gains 10 an hour: 80% after 30 minutes, and the compactor needs 40.
    expect(dispatchCompactors(0, [compactor(0, [600, 2400])], [tp(0, 10, 1), tp(1, 75, 10)])).toEqual([{ compactorId: 0, tp: 1 }]);
  });

  it('counts tippers due towards the urgency', () => {
    expect(dispatchCompactors(0, [compactor(0, [600])], [tp(0, 70, 0, 1)])).toEqual([{ compactorId: 0, tp: 0 }]);
  });

  it('sends each compactor to the most urgent point not yet taken, in compactor id order', () => {
    const tps = [tp(0, 85, 0), tp(1, 95, 0), tp(2, 90, 0)];
    const free = [compactor(3, [600, 600, 600]), compactor(1, [600, 600, 600])];
    expect(dispatchCompactors(0, free, tps)).toEqual([
      { compactorId: 1, tp: 1 },
      { compactorId: 3, tp: 2 },
    ]);
  });

  it('breaks urgency ties by travel time, then by point id', () => {
    expect(dispatchCompactors(0, [compactor(0, [900, 300])], [tp(0, 90, 0), tp(1, 90, 0)])).toEqual([{ compactorId: 0, tp: 1 }]);
    expect(dispatchCompactors(0, [compactor(0, [300, 300])], [tp(1, 90, 0), tp(0, 90, 0)])).toEqual([{ compactorId: 0, tp: 0 }]);
  });

  it('uses the configured threshold', () => {
    const tps = [tp(0, 60, 0)];
    expect(dispatchCompactors(0, [compactor(0, [60])], tps, { ...DEFAULT_DISPATCH, thresholdPct: 50 })).toHaveLength(1);
    expect(dispatchCompactors(0, [compactor(0, [60])], tps)).toHaveLength(0);
  });
});

describe('crew risk', () => {
  const spot = (id: number, sizeKg: number, growthKgPerHour = 0, nearbyBacklogKg = 0): SpotOutlook => ({ id, sizeKg, growthKgPerHour, nearbyBacklogKg });

  it('weighs size, growth and nearby backlog, and rises in a heatwave', () => {
    const s = spot(0, 400, 20, 800);
    const w = DEFAULT_CREW_WEIGHTS;
    expect(spotRisk(s, false)).toBeCloseTo(w.size * 400 + w.growth * 20 + w.nearby * 800, 9);
    expect(spotRisk(s, true)).toBeCloseTo(HEATWAVE_RISK * spotRisk(s, false), 9);
  });

  it('ranks the riskiest first, ties by id', () => {
    const ranked = rankSpots([spot(3, 100), spot(1, 900), spot(2, 100), spot(0, 500)], false);
    expect(ranked.map((s) => s.id)).toEqual([1, 0, 2, 3]);
  });

  it('dispatches inside the night window under both policies', () => {
    const mid = (NIGHT_WINDOW[0] + NIGHT_WINDOW[1]) / 2;
    expect(mayDispatch(mid, 10, 'static')).toBe(true);
    expect(mayDispatch(mid, 10, 'dynamic')).toBe(true);
  });

  it('dispatches in daytime only under Dynamic and only at or above the critical size', () => {
    const noon = 12 * 3600;
    expect(mayDispatch(noon, CRITICAL_SPOT_KG, 'dynamic')).toBe(true);
    expect(mayDispatch(noon, CRITICAL_SPOT_KG - 1, 'dynamic')).toBe(false);
    expect(mayDispatch(noon, 10 * CRITICAL_SPOT_KG, 'static')).toBe(false);
  });
});
