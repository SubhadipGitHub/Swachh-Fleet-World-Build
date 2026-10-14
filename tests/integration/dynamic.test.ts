import { describe, expect, it } from 'vitest';
import type { Levers, ScenarioSpec } from '../../src/config/scenario';
import { DAY_SEC, at } from '../../src/sim/clock';
import { keyedChance } from '../../src/sim/conditions';
import type { SimEvent } from '../../src/sim/events';
import { planDynamic } from '../../src/sim/policies/dynamic';
import { DAILY_CUTOFF_SEC, DAILY_PLAN_SEC, REPLAN_DELAY_SEC, type DayPlan, type PlanRequest, type Planner } from '../../src/sim/policies/types';
import {
  blackSpotViews,
  createWorld,
  currentPolicy,
  drainEvents,
  isHeld,
  massBalance,
  observe,
  pendingPlanRequests,
  providePlan,
  runUntil,
  setPolicy,
  setWeather,
  stepWorld,
  vehicleExplain,
  worldTime,
  type World,
  type WorldConfig,
  type WorldOptions,
} from '../../src/sim/world';
import { buildFloodTown, buildTown, townConfig, townSpec } from '../fixtures/town';

// Requirements M3-1, M3-5, M3-9, M3-10, R-5 and architecture M3-D2, M3-D6, M3-D9, M3-D10 (town fixture: 4 tippers,
// tipper ids 0–3, 60 street segments).

const TIPPERS = 4;
const NO_LEVERS: Levers = { tipperAbsenceRate: 0, breakdownChancePerShift: 0, skipChance: 0 };

function world(spec: Partial<ScenarioSpec> = {}, config: Partial<WorldConfig> = {}, options: WorldOptions = { planner: planDynamic }, town = buildTown()): World {
  return createWorld(town, townConfig(config), townSpec({ policy: 'dynamic', ...spec }), options);
}

function runFor(w: World, until: number): SimEvent[] {
  runUntil(w, until);
  return drainEvents(w);
}

type Ev<K extends SimEvent['kind']> = Extract<SimEvent, { kind: K }>;
const ofKind = <K extends SimEvent['kind']>(events: SimEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);
const servedSegments = (events: SimEvent[]): number[] => ofKind(events, 'StopServed').flatMap((e) => (e.target.type === 'segment' ? [e.target.id] : []));

/** Tippers absent on a day for a seed and rate, using the keyed draw (keys: tipper, day; M3-D1). */
function absentOn(seed: number, rate: number, day: number): number[] {
  return Array.from({ length: TIPPERS }, (_, v) => v).filter((v) => keyedChance(seed, 'absence', rate, v, day));
}

/** The first seed from 1 for which `ok` holds of each day's absences. */
function seedWhere(rate: number, days: number, ok: (absent: number[]) => boolean): number {
  for (let seed = 1; seed < 500; seed++) if (Array.from({ length: days }, (_, d) => absentOn(seed, rate, d)).every(ok)) return seed;
  throw new Error('no seed found');
}

describe('the daily plan (M3-D9)', () => {
  it('freezes its inputs at 05:00 and takes effect at 05:30, every day', () => {
    const requests: PlanRequest[] = [];
    const spy: Planner = (req) => {
      requests.push(req);
      return planDynamic(req);
    };
    const events = runFor(world({ days: 2 }, {}, { planner: spy }), 2 * DAY_SEC);
    const daily = requests.filter((r) => r.cause === 'daily');
    expect(daily.map((r) => [r.madeAt, r.dueAt])).toEqual([
      [DAILY_CUTOFF_SEC, DAILY_PLAN_SEC],
      [DAY_SEC + DAILY_CUTOFF_SEC, DAY_SEC + DAILY_PLAN_SEC],
    ]);
    for (const r of daily) {
      expect(r.view.t).toBe(r.madeAt);
      expect([...r.vehicleIds].sort()).toEqual(r.view.roster.filter((x) => x.kind === 'auto-tipper' && x.present).map((x) => x.id).sort());
    }
    expect(ofKind(events, 'Replanned').filter((e) => e.cause === 'daily').map((e) => e.t)).toEqual([DAILY_PLAN_SEC, DAY_SEC + DAILY_PLAN_SEC]);
  });

  it('gives the same result whether the plan comes inline or arrives just in time (the clock holds)', () => {
    const inline = world({ days: 1, levers: { ...NO_LEVERS, tipperAbsenceRate: 0.3 } });
    const late = world({ days: 1, levers: { ...NO_LEVERS, tipperAbsenceRate: 0.3 } }, {}, {});
    const evInline = runFor(inline, DAY_SEC);
    const evLate: SimEvent[] = [];
    let held = 0;
    while (worldTime(late) < DAY_SEC) {
      if (isHeld(late)) {
        held++;
        const req = pendingPlanRequests(late)[0]!;
        expect(worldTime(late)).toBe(req.dueAt);
        const before = worldTime(late);
        stepWorld(late); // still held: nothing moves
        expect(worldTime(late)).toBe(before);
        providePlan(late, planDynamic(req));
        continue;
      }
      stepWorld(late);
      evLate.push(...drainEvents(late));
    }
    expect(held).toBeGreaterThan(0);
    expect(evLate).toEqual(evInline);
  });
});

describe('Dynamic tipper beats (M3-5, M3-D6)', () => {
  it('shares an absent tipper’s streets out, where Static leaves them unserved', () => {
    const seed = seedWhere(0.3, 1, (a) => a.length === 1);
    const levers = { ...NO_LEVERS, tipperAbsenceRate: 0.3 };
    const [absent] = absentOn(seed, 0.3, 0);
    const stat = world({ seed, policy: 'static', levers });
    const statEvents = runFor(stat, DAY_SEC);
    const beat = vehicleExplain(stat, absent!)!.planned.map((p) => p.segmentId);
    expect(beat.length).toBeGreaterThan(0);
    const statServed = new Set(servedSegments(statEvents));
    expect(beat.filter((s) => statServed.has(s))).toEqual([]);

    const dyn = world({ seed, levers });
    const served = new Set(servedSegments(runFor(dyn, DAY_SEC)));
    const deferred = new Map(Array.from({ length: TIPPERS }, (_, v) => vehicleExplain(dyn, v)?.deferred ?? []).flat().map((d) => [d.segmentId, d.reason]));
    for (const s of beat) expect(served.has(s) || deferred.has(s), `segment ${s}`).toBe(true);
    expect(beat.filter((s) => served.has(s)).length).toBeGreaterThan(beat.length / 2);
  });

  it('re-plans 300 s after a tipper breaks down, re-routing only present tippers including the broken one', () => {
    const events = runFor(world({ levers: { ...NO_LEVERS, breakdownChancePerShift: 1 } }), DAY_SEC);
    const tipperBreakdowns = ofKind(events, 'BrokenDown').filter((e) => e.vehicleId < TIPPERS && e.t < at(0, 14, 0) - REPLAN_DELAY_SEC);
    expect(tipperBreakdowns.length).toBeGreaterThan(0);
    const replans = ofKind(events, 'Replanned').filter((e) => e.cause === 'breakdown');
    for (const b of tipperBreakdowns) {
      const r = replans.find((x) => x.t === b.t + REPLAN_DELAY_SEC && x.vehicleIds.includes(b.vehicleId));
      expect(r, `breakdown of ${b.vehicleId} at ${b.t}`).toBeDefined();
      for (const id of r!.vehicleIds) expect(id).toBeLessThan(TIPPERS);
    }
  });

  it('defers streets cut off by a closure as `closed`, and does not serve them while closed', () => {
    const w = world({}, {}, { planner: planDynamic }, buildFloodTown());
    setWeather(w, 'monsoon');
    const events = runFor(w, at(0, 14, 0));
    const closed = observe(w).closedSegments;
    expect(closed.length).toBeGreaterThan(0);
    const deferred = Array.from({ length: TIPPERS }, (_, v) => vehicleExplain(w, v)?.deferred ?? []).flat();
    for (const s of closed) expect(deferred.find((d) => d.segmentId === s)?.reason, `segment ${s}`).toBe('closed');
    const served = new Set(servedSegments(events));
    for (const s of closed) expect(served.has(s)).toBe(false);
  });

  it('leaves no street unserved for more than 48 h over four days (R-5)', () => {
    const rate = 0.3;
    const seed = seedWhere(rate, 4, (a) => a.length > 0 && a.length <= 2);
    const w = world({ seed, days: 4, levers: { ...NO_LEVERS, tipperAbsenceRate: rate } });
    const events = runFor(w, 4 * DAY_SEC);
    const last = new Map<number, number>();
    let worst = 0;
    for (const e of ofKind(events, 'StopServed')) {
      if (e.target.type !== 'segment') continue;
      worst = Math.max(worst, e.t - (last.get(e.target.id) ?? 0));
      last.set(e.target.id, e.t);
    }
    for (const seg of buildTown().segments) worst = Math.max(worst, 4 * DAY_SEC - (last.get(seg.id) ?? 0));
    expect(worst).toBeLessThanOrEqual(48 * 3600);
  });

  it('explains every Dynamic street, and marks Static streets as the beat', () => {
    const dyn = world({ levers: { ...NO_LEVERS, tipperAbsenceRate: 0.3 }, seed: seedWhere(0.3, 1, (a) => a.length === 1) });
    runUntil(dyn, at(0, 9, 0));
    const present = observe(dyn).roster.filter((r) => r.kind === 'auto-tipper' && r.present);
    for (const r of present) {
      const x = vehicleExplain(dyn, r.id)!;
      expect(x.policy).toBe('dynamic');
      expect(x.planned.length).toBeGreaterThan(0);
      for (const p of x.planned) {
        expect(['beat', 'backlog', 'fairness', 'blackSpotRisk']).toContain(p.reason);
        expect(p.predictedKg).toBeGreaterThanOrEqual(0);
        expect(p.hoursSinceServed).toBeGreaterThanOrEqual(0);
        expect(['normal', 'low']).toContain(p.confidence);
      }
      expect(x.replans.some((p) => p.cause === 'daily')).toBe(true);
    }
    const stat = world({ policy: 'static' });
    runUntil(stat, at(0, 9, 0));
    const s = vehicleExplain(stat, 0)!;
    expect(s.policy).toBe('static');
    expect(s.planned.every((p) => p.reason === 'beat')).toBe(true);
    expect(s.replans).toEqual([]);
    expect(vehicleExplain(stat, TIPPERS)).toBeNull(); // a compactor
  });
});

describe('switching policy (M3-1)', () => {
  it('re-plans once, 300 s after a mid-day switch', () => {
    const w = world({ policy: 'static' });
    runFor(w, at(0, 8, 0));
    expect(currentPolicy(w)).toBe('static');
    setPolicy(w, 'dynamic');
    expect(currentPolicy(w)).toBe('dynamic');
    const events = runFor(w, at(0, 8, 30));
    expect(ofKind(events, 'Replanned').map((e) => [e.t, e.cause])).toEqual([[at(0, 8, 0) + REPLAN_DELAY_SEC, 'policy']]);
  });

  it('collapses several switches inside the window into one re-plan from the latest switch', () => {
    const w = world({ policy: 'static' });
    runFor(w, at(0, 8, 0));
    setPolicy(w, 'dynamic');
    runFor(w, at(0, 8, 1));
    setPolicy(w, 'static');
    runFor(w, at(0, 8, 2));
    setPolicy(w, 'dynamic');
    const events = runFor(w, at(0, 8, 30));
    expect(ofKind(events, 'Replanned').map((e) => [e.t, e.cause])).toEqual([[at(0, 8, 2) + REPLAN_DELAY_SEC, 'policy']]);
  });

  it('goes back to the fixed beats when switched to Static', () => {
    const w = world();
    runFor(w, at(0, 8, 0));
    setPolicy(w, 'static');
    runFor(w, at(0, 8, 10));
    const x = vehicleExplain(w, 0)!;
    expect(x.policy).toBe('static');
    expect(x.planned.every((p) => p.reason === 'beat')).toBe(true);
  });
});

describe('when the solver fails (M3-D9)', () => {
  const failing: Planner = () => {
    throw new Error('boom');
  };

  it('falls back to the static beats for the day and says so', () => {
    const events = runFor(world({}, {}, { planner: failing }), DAY_SEC);
    const failed = ofKind(events, 'PlanFailed');
    expect(failed.map((e) => [e.t, e.cause])).toEqual([[DAILY_PLAN_SEC, 'daily']]);
    expect(failed[0]!.reason).toMatch(/boom/);
    const stat = runFor(world({ policy: 'static' }), DAY_SEC);
    expect(servedSegments(events)).toEqual(servedSegments(stat));
  });

  it('rejects an invalid plan the same way', () => {
    const duplicate: Planner = (req) => {
      const plan: DayPlan = planDynamic(req);
      const [a, b] = plan.routes;
      if (!a || !b || a.stops.length === 0) return plan;
      return { ...plan, routes: [a, { ...b, stops: [...b.stops, a.stops[0]!] }, ...plan.routes.slice(2)] };
    };
    const failed = ofKind(runFor(world({}, {}, { planner: duplicate }), DAY_SEC), 'PlanFailed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toMatch(/twice/i);
  });
});

describe('new world behaviour (M3-D2)', () => {
  it('early returns skip the rest of a beat in the second half of the shift', () => {
    // One tipper for the whole town, so its beat (about 10 h of work) is still going in the second half of the shift.
    const fleet = { ...townConfig().fleet, autoTippers: 1 };
    const events = runFor(world({ policy: 'static', levers: { ...NO_LEVERS, earlyReturnChance: 1 } }, { fleet }), DAY_SEC);
    const early = ofKind(events, 'StopSkipped').filter((e) => e.reason === 'early-return');
    expect(early.length).toBeGreaterThan(0);
    for (const e of early) expect(e.t).toBeGreaterThanOrEqual(at(0, 10, 0));
  });

  it('leaks part of the old backlog and keeps the books balanced', () => {
    const w = world({ policy: 'static', days: 4, levers: { ...NO_LEVERS, tipperAbsenceRate: 1 } }, { leakageSharePerDay: 0.3 });
    runUntil(w, 4 * DAY_SEC);
    const b = massBalance(w);
    expect(b.leakedKg).toBeGreaterThan(0);
    expect(b.uncollectedKg + b.onVehiclesKg + b.atTransferPointsKg + b.deliveredKcdcKg + b.deliveredLandfillKg + b.leakedKg).toBeCloseTo(b.generatedKg, 3);
  });

  it('dumps backlog older than 48 h at the nearest black spot within the radius', () => {
    const spots = (dumpRadiusM: number): number => {
      const fleet = { ...townConfig().fleet, crews: 0 };
      const w = world({ policy: 'static', days: 3, levers: { ...NO_LEVERS, tipperAbsenceRate: 1 } }, { fleet, dumpRadiusM }, {});
      runUntil(w, 3 * DAY_SEC);
      const b = massBalance(w);
      expect(b.uncollectedKg + b.onVehiclesKg + b.atTransferPointsKg + b.deliveredKcdcKg + b.deliveredLandfillKg + b.leakedKg).toBeCloseTo(b.generatedKg, 3);
      return blackSpotViews(w).reduce((a, x) => a + x.sizeKg, 0);
    };
    expect(spots(2000)).toBeGreaterThan(spots(0) + 1);
  });
});
