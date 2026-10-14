import { describe, expect, it } from 'vitest';
import { getCalibration } from '../../src/config/calibration';
import { deriveClusterScale } from '../../src/config/derive';
import { decodeSnapshot } from '../../src/geo/snapshot';
import { buildMapData } from '../../src/sim/map-data';
import { planDynamic } from '../../src/sim/policies/dynamic';
import { DAILY_BUDGET, REPLAN_BUDGET } from '../../src/sim/policies/types';
import { createWorld, isHeld, pendingPlanRequests, providePlan, stepWorld, worldTime } from '../../src/sim/world';
import { baselineLevers, defaultWorldConfig } from '../../src/sim/world-config';
import { loadLatestSnapshot } from './snapshot';

// Requirement M3-13 and architecture M3-D9: the 05:30 plan for the real cluster takes ≤ 2 s and an incident re-plan
// ≤ 0.5 s on the dev laptop; asserted with a 2× margin, at the fixed iteration budgets.

describe('planner performance', () => {
  it('plans the day within 4 s and re-plans within 1 s, inside the iteration budgets', () => {
    const cal = getCalibration();
    const scale = deriveClusterScale(cal);
    const map = buildMapData(decodeSnapshot(loadLatestSnapshot()), scale, { smartBins: cal.smartBins.value, transferPoints: cal.transferPoints.value, seed: 1 });
    const world = createWorld(map, defaultWorldConfig(cal, scale, 'clear'), {
      v: 1,
      seed: 1,
      startDate: '2026-10-14',
      days: 1,
      weather: 'clear',
      policy: 'dynamic',
      levers: { ...baselineLevers(cal), breakdownChancePerShift: 0.3 },
    });
    const timings: { cause: string; ms: number; iterations: number; budget: number }[] = [];
    while (worldTime(world) < 12 * 3600) {
      if (isHeld(world)) {
        const req = pendingPlanRequests(world)[0]!;
        const start = performance.now();
        const plan = planDynamic(req);
        timings.push({ cause: req.cause, ms: performance.now() - start, iterations: plan.iterations, budget: req.budget });
        providePlan(world, plan);
        continue;
      }
      stepWorld(world);
    }
    console.info(timings.map((t) => `${t.cause}: ${t.ms.toFixed(0)} ms, ${t.iterations} iterations`).join('\n'));
    const daily = timings.filter((t) => t.cause === 'daily');
    const replans = timings.filter((t) => t.cause !== 'daily');
    expect(daily).toHaveLength(1);
    expect(replans.length).toBeGreaterThan(0);
    expect(daily[0]!.budget).toBe(DAILY_BUDGET);
    expect(daily[0]!.iterations).toBeLessThanOrEqual(DAILY_BUDGET);
    expect(daily[0]!.ms).toBeLessThanOrEqual(4000);
    for (const r of replans) {
      expect(r.budget).toBe(REPLAN_BUDGET);
      expect(r.iterations).toBeLessThanOrEqual(REPLAN_BUDGET);
      expect(r.ms).toBeLessThanOrEqual(1000);
    }
  });
});
