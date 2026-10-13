import { describe, expect, it } from 'vitest';
import { DAY_SEC, at } from '../../src/sim/clock';
import { hashEvents, type SimEvent } from '../../src/sim/events';
import { createWorld, drainEvents, massBalance, runUntil, stepWorld, vehicles, worldTime, type MassBalance, type World } from '../../src/sim/world';
import type { ScenarioSpec } from '../../src/config/scenario';
import type { WorldConfig } from '../../src/sim/world';
import { buildTown, townConfig, townSpec } from '../fixtures/town';

// Requirements L-1 to L-5 and architecture AD-5: one simulated day under the static policy, in the fixture town.

interface DayRun {
  readonly world: World;
  readonly events: SimEvent[];
  readonly balance: MassBalance;
}

function runDay(spec: Partial<ScenarioSpec> = {}, config: Partial<WorldConfig> = {}): DayRun {
  const world = createWorld(buildTown(), townConfig(config), townSpec(spec));
  const events: SimEvent[] = [];
  for (let h = 1; h <= 24; h++) {
    runUntil(world, h * 3600);
    events.push(...drainEvents(world));
  }
  return { world, events, balance: massBalance(world) };
}

const balanceTotal = (b: MassBalance): number => b.uncollectedKg + b.onVehiclesKg + b.atTransferPointsKg + b.deliveredKcdcKg + b.deliveredLandfillKg;

describe('one simulated day (static policy)', () => {
  it('advances exactly one second per step', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    expect(worldTime(world)).toBe(0);
    stepWorld(world);
    stepWorld(world);
    expect(worldTime(world)).toBe(2);
    runUntil(world, 100);
    expect(worldTime(world)).toBe(100);
    expect(() => runUntil(world, 50)).toThrow(RangeError);
  });

  it('is deterministic: the same seed gives the same event stream and mass balance (L-5)', () => {
    const a = runDay();
    const b = runDay();
    expect(hashEvents(b.events)).toBe(hashEvents(a.events));
    expect(b.balance).toEqual(a.balance);
  });

  it('a different seed gives a different day', () => {
    expect(hashEvents(runDay({ seed: 1 }).events)).not.toBe(hashEvents(runDay({ seed: 2 }).events));
  });

  it('matches the golden event-stream hash (update deliberately with -u when behaviour changes)', () => {
    expect(hashEvents(runDay().events)).toMatchSnapshot();
  });

  it('emits events in time order, all within the day', () => {
    const { events } = runDay();
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
    expect(events[0]!.t).toBeGreaterThanOrEqual(0);
    expect(events[events.length - 1]!.t).toBeLessThanOrEqual(DAY_SEC);
  });

  it('conserves mass: every kilogram generated is somewhere', () => {
    const { balance } = runDay();
    expect(balance.generatedKg).toBeGreaterThan(0);
    expect(balanceTotal(balance)).toBeCloseTo(balance.generatedKg, 3);
    for (const v of Object.values(balance)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('generates about one day of household and market waste', () => {
    const { balance } = runDay();
    const expected = 3_600 * 1.53 + 4 * 120;
    expect(balance.generatedKg / expected).toBeGreaterThan(0.95);
    expect(balance.generatedKg / expected).toBeLessThan(1.05);
  });

  it('collects and delivers waste to KCDC', () => {
    const { balance, events } = runDay();
    expect(balance.deliveredKcdcKg).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'Tipped')).toBe(true);
    expect(events.some((e) => e.kind === 'Weighed')).toBe(true);
    const unloadedKcdc = events.filter((e): e is Extract<SimEvent, { kind: 'Unloaded' }> => e.kind === 'Unloaded' && e.site === 'KCDC');
    expect(unloadedKcdc.reduce((s, e) => s + e.kg, 0)).toBeCloseTo(balance.deliveredKcdcKg, 3);
  });

  it('serves every street segment at least once with a full, compliant fleet', () => {
    const { events } = runDay();
    const town = buildTown();
    const served = new Set(events.filter((e) => e.kind === 'StopServed' && e.target.type === 'segment').map((e) => (e as Extract<SimEvent, { kind: 'StopServed' }>).target.id));
    for (const s of town.segments) if (s.households > 0) expect(served.has(s.id), `segment ${s.id}`).toBe(true);
  });

  it('keeps auto-tippers inside their shift window', () => {
    const { events } = runDay();
    const tipperIds = new Set(vehicles(createWorld(buildTown(), townConfig(), townSpec())).filter((v) => v.kind === 'auto-tipper').map((v) => v.id));
    for (const e of events) {
      if (e.kind === 'ShiftStarted' && tipperIds.has(e.vehicleId)) expect(e.t).toBeGreaterThanOrEqual(at(0, 6, 0));
      if (e.kind === 'StopServed' && tipperIds.has(e.vehicleId)) expect(e.t).toBeLessThanOrEqual(at(0, 14, 0));
    }
  });

  it('ends the day with every vehicle off shift and every crew idle', () => {
    const { world } = runDay();
    for (const v of vehicles(world)) expect(v.state, `${v.kind} ${v.id}`).toBe(v.kind === 'crew' ? 'Idle' : 'OffShift');
  });

  it('under static routing, absent tippers leave their beats unserved', () => {
    const { events } = runDay({ levers: { tipperAbsenceRate: 1, breakdownChancePerShift: 0, skipChance: 0 } });
    expect(events.filter((e) => e.kind === 'VehicleAbsent')).toHaveLength(4);
    expect(events.some((e) => e.kind === 'StopServed' && e.target.type === 'segment')).toBe(false);
  });

  it('diverts every load to the landfill when KCDC has no intake capacity', () => {
    const { events, balance } = runDay({}, { kcdcIntakeCapKg: 0 });
    expect(balance.deliveredKcdcKg).toBe(0);
    expect(balance.deliveredLandfillKg).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'Diverted')).toBe(true);
  });

  it('reports bin sensor readings every 15 minutes (L-1 step 2)', () => {
    const { events } = runDay();
    const readings = events.filter((e) => e.kind === 'SensorReading' && e.binId === 0);
    expect(readings).toHaveLength(96);
    readings.forEach((e, i) => expect(e.t).toBe((i + 1) * 900));
  });
});
