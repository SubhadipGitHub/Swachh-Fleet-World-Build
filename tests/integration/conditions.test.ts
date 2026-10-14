import { beforeAll, describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../../src/config/scenario';
import { DAY_SEC } from '../../src/sim/clock';
import type { SimEvent } from '../../src/sim/events';
import { planDynamic } from '../../src/sim/policies/dynamic';
import { createWorld, drainEvents, massBalance, runUntil, setWeather, type World, type WorldConfig } from '../../src/sim/world';
import { buildFloodTown, townConfig, townSpec } from '../fixtures/town';

// Requirement M3-2 and architecture M3-D1: the live world and the twin face the same conditions, whatever the
// policy does, because conditions are keyed draws.

const LEVERS = { tipperAbsenceRate: 0.3, breakdownChancePerShift: 0.3, skipChance: 0.05, earlyReturnChance: 0.2 };
const CONFIG: Partial<WorldConfig> = { generationSigma: 0.2, sensor: { noiseSdPct: 3, faultChancePerReading: 0.01, recoverChancePerReading: 0.05 } };

function pair(days: number, weatherAt?: { t: number; mode: 'monsoon' | 'clear' }[]): { stat: SimEvent[]; dyn: SimEvent[]; worlds: [World, World] } {
  const spec = (policy: ScenarioSpec['policy']): ScenarioSpec => townSpec({ days, policy, levers: LEVERS });
  const stat = createWorld(buildFloodTown(), townConfig(CONFIG), spec('static'));
  const dyn = createWorld(buildFloodTown(), townConfig(CONFIG), spec('dynamic'), { planner: planDynamic });
  const out: [SimEvent[], SimEvent[]] = [[], []];
  const steps = [...(weatherAt ?? []), { t: days * DAY_SEC, mode: null }];
  for (const s of steps) {
    for (const [i, w] of [stat, dyn].entries()) {
      runUntil(w, s.t);
      out[i]!.push(...drainEvents(w));
      if (s.mode) setWeather(w, s.mode);
    }
  }
  return { stat: out[0], dyn: out[1], worlds: [stat, dyn] };
}

const absences = (events: SimEvent[]): string[] => events.flatMap((e) => (e.kind === 'VehicleAbsent' ? [`${e.t}:${e.vehicleId}`] : []));
const sensorStatuses = (events: SimEvent[]): string[] => events.flatMap((e) => (e.kind === 'SensorReading' ? [`${e.t}:${e.binId}:${e.status}`] : []));

describe('same conditions under Static and Dynamic (M3-D1)', () => {
  let run: ReturnType<typeof pair>;
  beforeAll(() => {
    run = pair(3, [
      { t: 1 * DAY_SEC + 8 * 3600, mode: 'monsoon' },
      { t: 2 * DAY_SEC + 6 * 3600, mode: 'clear' },
    ]);
  });

  it('the same tippers are absent on the same days', () => {
    expect(absences(run.stat).length).toBeGreaterThan(0);
    expect(absences(run.dyn)).toEqual(absences(run.stat));
  });

  it('the sensors fail and recover at the same readings', () => {
    expect(sensorStatuses(run.stat).some((s) => !s.endsWith(':ok'))).toBe(true);
    expect(sensorStatuses(run.dyn)).toEqual(sensorStatuses(run.stat));
  });

  it('the same waste is generated, with day-to-day variability, and the weather applies to both', () => {
    const [s, d] = run.worlds;
    expect(massBalance(d).generatedKg).toBeCloseTo(massBalance(s).generatedKg, 6);
    const flat = createWorld(buildFloodTown(), townConfig({ ...CONFIG, generationSigma: 0 }), townSpec({ days: 3, levers: LEVERS }));
    runUntil(flat, 3 * DAY_SEC);
    expect(Math.abs(massBalance(s).generatedKg - massBalance(flat).generatedKg)).toBeGreaterThan(1);
    expect(run.stat.filter((e) => e.kind === 'RoadClosed').map((e) => e.t)).toEqual(run.dyn.filter((e) => e.kind === 'RoadClosed').map((e) => e.t));
  });

  it('two Static worlds with the same seed match event for event across weather changes', () => {
    const a = pair(2, [{ t: 9 * 3600, mode: 'monsoon' }]);
    const b = createWorld(buildFloodTown(), townConfig(CONFIG), townSpec({ days: 2, levers: LEVERS }));
    runUntil(b, 9 * 3600);
    const evB = drainEvents(b);
    setWeather(b, 'monsoon');
    runUntil(b, 2 * DAY_SEC);
    evB.push(...drainEvents(b));
    expect(evB).toEqual(a.stat);
  });
});
