import { describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../../src/config/scenario';
import { DAY_SEC } from '../../src/sim/clock';
import type { SimEvent } from '../../src/sim/events';
import {
  binViews,
  blackSpotViews,
  createWorld,
  drainEvents,
  laneOffsetM,
  massBalance,
  runUntil,
  transferPointViews,
  vehiclePlan,
  vehicles,
  vehicleViews,
  type MassBalance,
  type WorldConfig,
} from '../../src/sim/world';
import { buildTown, townConfig, townSpec } from '../fixtures/town';

// Requirements L-2 (black spots and clearance), L-3 (breakdowns, non-compliance), X-1 (monsoon), L-7 (live state).

function day(spec: Partial<ScenarioSpec> = {}, config: Partial<WorldConfig> = {}): { events: SimEvent[]; balance: MassBalance; world: ReturnType<typeof createWorld> } {
  const world = createWorld(buildTown(), townConfig(config), townSpec(spec));
  runUntil(world, DAY_SEC);
  return { events: drainEvents(world), balance: massBalance(world), world };
}

const total = (b: MassBalance): number => b.uncollectedKg + b.onVehiclesKg + b.atTransferPointsKg + b.deliveredKcdcKg + b.deliveredLandfillKg;
const kinds = (events: SimEvent[], kind: SimEvent['kind']): SimEvent[] => events.filter((e) => e.kind === kind);

describe('disruptions', () => {
  it('breaks vehicles down and repairs them, keeping the books balanced', () => {
    const { events, balance, world } = day({ levers: { tipperAbsenceRate: 0, breakdownChancePerShift: 1, skipChance: 0 } });
    expect(kinds(events, 'BrokenDown').length).toBeGreaterThan(0);
    expect(kinds(events, 'Repaired').length + kinds(events, 'StopSkipped').filter((e) => e.kind === 'StopSkipped' && e.reason === 'breakdown').length).toBeGreaterThan(0);
    expect(total(balance)).toBeCloseTo(balance.generatedKg, 3);
    for (const v of vehicles(world)) expect(v.state, `${v.kind} ${v.id}`).toBe(v.kind === 'crew' ? 'Idle' : 'OffShift');
  });

  it('a driver who skips every stop serves no street (non-compliance)', () => {
    const { events } = day({ levers: { tipperAbsenceRate: 0, breakdownChancePerShift: 0, skipChance: 1 } });
    expect(events.some((e) => e.kind === 'StopServed' && e.target.type === 'segment')).toBe(false);
    expect(events.filter((e) => e.kind === 'StopSkipped' && e.reason === 'non-compliance').length).toBe(60);
  });

  it('activates black spots where streets are neglected and clears them by night, waste to the landfill', () => {
    const { events, balance, world } = day({ levers: { tipperAbsenceRate: 1, breakdownChancePerShift: 0, skipChance: 0 } }, { blackSpotBaseChancePerHour: 0.9 });
    expect(kinds(events, 'BlackSpotActivated').length).toBeGreaterThan(0);
    const cleared = kinds(events, 'BlackSpotCleared');
    expect(cleared.length).toBeGreaterThan(0);
    for (const e of cleared) expect(e.t % DAY_SEC).toBeGreaterThanOrEqual(14 * 3600);
    expect(balance.deliveredLandfillKg).toBeGreaterThan(0);
    expect(total(balance)).toBeCloseTo(balance.generatedKg, 3);
    expect(vehicles(world).filter((v) => v.kind === 'crew').every((v) => v.state === 'Idle')).toBe(true);
  });

  it('a tipper that fills up mid-beat tips at its transfer point and comes back to finish the beat', () => {
    const { events, balance, world } = day({}, { fleet: { ...townConfig().fleet, tipperPayloadKg: 150 } });
    const tips = kinds(events, 'Tipped');
    expect(tips.length).toBeGreaterThan(8);
    const served = new Set(events.filter((e) => e.kind === 'StopServed' && e.target.type === 'segment').map((e) => (e as Extract<SimEvent, { kind: 'StopServed' }>).target.id));
    expect(served.size).toBe(60);
    for (const e of tips) expect((e as Extract<SimEvent, { kind: 'Tipped' }>).kg).toBeLessThanOrEqual(150 + 1e-6);
    expect(total(balance)).toBeCloseTo(balance.generatedKg, 3);
    expect(vehicles(world).filter((v) => v.kind === 'auto-tipper').every((v) => v.state === 'OffShift')).toBe(true);
  });

  it('diverts to the landfill only once KCDC reaches its daily intake cap', () => {
    const { events, balance } = day({}, { kcdcIntakeCapKg: 1500 });
    expect(balance.deliveredKcdcKg).toBeGreaterThan(0);
    expect(balance.deliveredKcdcKg).toBeLessThanOrEqual(1500);
    const firstDiversion = kinds(events, 'Diverted')[0];
    const kcdcUnloads = events.filter((e) => e.kind === 'Unloaded' && e.site === 'KCDC' && e.kg > 0);
    if (firstDiversion) expect(kcdcUnloads[0]!.t).toBeLessThan(firstDiversion.t);
    expect(total(balance)).toBeCloseTo(balance.generatedKg, 3);
  });

  it('generates about 9% more by weight in a monsoon (wet waste +15%)', () => {
    const clear = day().balance.generatedKg;
    const monsoon = day({ weather: 'monsoon' }).balance.generatedKg;
    expect(monsoon / clear).toBeCloseTo(1.09, 3);
  });
});

describe('views (L-7)', () => {
  it('describes every vehicle, bin, black spot and transfer point', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(world, 8 * 3600);
    const vs = vehicleViews(world);
    expect(vs).toHaveLength(7);
    expect(vs.filter((v) => v.kind === 'auto-tipper' && v.edge >= 0).length).toBeGreaterThan(0);
    for (const v of vs) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
      expect(v.kmToday).toBeGreaterThanOrEqual(0);
      expect(v.fuelLitresToday).toBeGreaterThanOrEqual(0);
    }
    const parked = vs.filter((v) => v.edge < 0 && v.visible);
    const spots = new Set(parked.map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`));
    expect(spots.size).toBe(parked.length);
    expect(binViews(world)).toHaveLength(4);
    expect(blackSpotViews(world).every((s) => s.state === 'Dormant' || s.sizeKg >= 0)).toBe(true);
    expect(transferPointViews(world).reduce((a, t) => a + t.compactorsAssigned, 0)).toBe(2);
    const plan = vehiclePlan(world, 0)!;
    expect(plan.beatEdges.length).toBeGreaterThan(0);
    expect(vehiclePlan(world, 99)).toBeNull();
  });

  it('keeps drivers left: both directions of a two-way street sit left of the centre line', () => {
    const map = buildTown();
    const g = map.graph;
    expect(laneOffsetM(g, 0, 0)).toBeGreaterThan(0);
    expect(laneOffsetM(g, g.edgeTwin[0]!, 0)).toBeGreaterThan(0);
  });
});
