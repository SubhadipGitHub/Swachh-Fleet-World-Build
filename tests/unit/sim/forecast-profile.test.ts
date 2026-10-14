import { describe, expect, it } from 'vitest';
import { DAY_SEC } from '../../../src/sim/clock';
import { FillProfile, ForecastError, RateLearner, hourOfWeek, segmentBacklogKg } from '../../../src/sim/forecast';
import { defaultProfiles } from '../../../src/sim/generation';

// Requirement M3-4 and architecture M3-D5: forecasts from what an operator can see.

const H = 3600;
const PERIOD = 900;

/** A planted pattern: 4 points an hour from 08:00 to 12:00 on weekdays, 0.5 an hour otherwise (t = 0 is a Monday). */
function plantedRate(t: number): number {
  const day = Math.floor(t / DAY_SEC) % 7;
  const hour = Math.floor((t % DAY_SEC) / H);
  return day < 5 && hour >= 8 && hour < 12 ? 4 : 0.5;
}

/** Feeds `days` of 15-minute readings of the planted pattern, emptied (served) at 06:00 each day. */
function trained(days: number): FillProfile {
  const p = new FillProfile(0);
  let pct = 0;
  for (let t = PERIOD; t <= days * DAY_SEC; t += PERIOD) {
    pct += (plantedRate(t - PERIOD) * PERIOD) / H;
    let served = false;
    if (t % DAY_SEC === 6 * H) {
      pct = 0;
      served = true;
    }
    p.observe({ t, pct, status: 'ok' }, served);
  }
  return p;
}

describe('hourOfWeek', () => {
  it('counts from Monday 00:00 for a Monday start, and shifts with the start weekday', () => {
    expect(hourOfWeek(0, 0)).toBe(0);
    expect(hourOfWeek(9 * H + 1800, 0)).toBe(9);
    expect(hourOfWeek(DAY_SEC + 3 * H, 0)).toBe(27);
    expect(hourOfWeek(7 * DAY_SEC, 0)).toBe(0);
    expect(hourOfWeek(0, 2)).toBe(48);
    expect(hourOfWeek(5 * DAY_SEC, 2)).toBe(0);
  });
});

describe('FillProfile', () => {
  it('learns a planted hour-of-week pattern from readings', () => {
    const p = trained(14);
    expect(p.rateAt(9)).toBeCloseTo(4, 1);
    expect(p.rateAt(20)).toBeCloseTo(0.5, 1);
    expect(p.rateAt(5 * 24 + 9)).toBeCloseTo(0.5, 1); // Saturday morning is quiet
  });

  it('predicts by integrating the learned profile from the last reading', () => {
    const p = trained(14);
    const last = 14 * DAY_SEC; // Monday 00:00 again
    const f = p.predict(last + 12 * H)!;
    // Last reading: 18 h of Sunday at 0.5 since the 06:00 service. Then Monday 00:00–08:00 at 0.5 and 08:00–12:00 at 4.
    const lastPct = ((14 * DAY_SEC - (13 * DAY_SEC + 6 * H)) / H) * 0.5;
    expect(f.pct).toBeCloseTo(lastPct + 8 * 0.5 + 4 * 4, 0);
    expect(f.confidence).toBe('normal');
  });

  it('falls back to the two-point line with under 24 h of history, at low confidence', () => {
    const p = new FillProfile(0);
    p.observe({ t: 900, pct: 10, status: 'ok' }, false);
    p.observe({ t: 1800, pct: 12, status: 'ok' }, false);
    expect(p.historySec()).toBeLessThan(DAY_SEC);
    const f = p.predict(1800 + 2 * H)!;
    expect(f.pct).toBeCloseTo(12 + 8 * 2, 6);
    expect(f.confidence).toBe('low');
  });

  it('is null before any good reading', () => {
    const p = new FillProfile(0);
    expect(p.predict(H)).toBeNull();
    p.observe({ t: 900, pct: null, status: 'offline' }, false);
    expect(p.predict(H)).toBeNull();
  });

  it('marks forecasts low-confidence while the sensor is stuck or offline', () => {
    const p = trained(3);
    expect(p.predict(3 * DAY_SEC + H)!.confidence).toBe('normal');
    p.observe({ t: 3 * DAY_SEC + PERIOD, pct: null, status: 'offline' }, false);
    expect(p.predict(3 * DAY_SEC + H)!.confidence).toBe('low');
    p.observe({ t: 3 * DAY_SEC + 2 * PERIOD, pct: 40, status: 'stuck' }, false);
    expect(p.predict(3 * DAY_SEC + H)!.confidence).toBe('low');
  });

  it('does not learn across a service, or from stuck readings', () => {
    const p = new FillProfile(0);
    p.observe({ t: 0, pct: 80, status: 'ok' }, false);
    p.observe({ t: H, pct: 5, status: 'ok' }, true); // emptied in between: no negative rate learned
    expect(p.rateAt(0)).toBeNull();
    p.observe({ t: 2 * H, pct: 5, status: 'stuck' }, false);
    p.observe({ t: 3 * H, pct: 5, status: 'stuck' }, false);
    expect(p.rateAt(1)).toBeNull();
    expect(p.rateAt(2)).toBeNull();
  });

  it('never predicts outside 0–150', () => {
    const p = trained(7);
    expect(p.predict(7 * DAY_SEC + 30 * DAY_SEC)!.pct).toBeLessThanOrEqual(150);
    expect(p.predict(7 * DAY_SEC + H)!.pct).toBeGreaterThanOrEqual(0);
  });
});

describe('segmentBacklogKg', () => {
  const household = defaultProfiles().household;

  it('is households × r̂ × days for whole days, and zero at the service time', () => {
    expect(segmentBacklogKg(60, 0.5, DAY_SEC, DAY_SEC, household)).toBe(0);
    expect(segmentBacklogKg(60, 0.5, 6 * H, 6 * H + 2 * DAY_SEC, household)).toBeCloseTo(60, 6);
  });

  it('follows the household curve within a day (more by midday than overnight)', () => {
    const morning = segmentBacklogKg(100, 1, 6 * H, 12 * H, household);
    const night = segmentBacklogKg(100, 1, 0, 6 * H, household);
    expect(morning).toBeGreaterThan(night);
    expect(morning + night + segmentBacklogKg(100, 1, 12 * H, DAY_SEC, household)).toBeCloseTo(100, 6);
  });
});

describe('RateLearner', () => {
  it('starts at the prior and learns a surge from weigh-ins', () => {
    const r = new RateLearner(0.5, 0.3);
    expect(r.value()).toBe(0.5);
    for (let d = 0; d < 20; d++) r.update(0.6 * 1000, 1000);
    expect(r.value()).toBeCloseTo(0.6, 3);
  });

  it('ignores a day with nothing collected', () => {
    const r = new RateLearner(0.5);
    r.update(0, 0);
    expect(r.value()).toBe(0.5);
  });
});

describe('ForecastError', () => {
  it('keeps a running mean absolute error, null before any score', () => {
    const e = new ForecastError();
    expect(e.mae()).toBeNull();
    e.record(50, 40);
    e.record(30, 34);
    expect(e.count()).toBe(2);
    expect(e.mae()).toBeCloseTo(7, 9);
  });
});
