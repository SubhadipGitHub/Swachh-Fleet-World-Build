import { describe, expect, it } from 'vitest';
import { estimateRouteSec, planArcs, validateArcPlan, type ArcPlan, type ArcVehicle } from '../../../src/routing/vrp/beats-dynamic';
import { arcInstance, staticBeatOwner } from '../../fixtures/arcs';

// Requirement M3-5 and architecture M3-D6: Dynamic auto-tipper beats.

const routeOf = (plan: ArcPlan, taskId: number): number | undefined => plan.routes.find((r) => r.tasks.includes(taskId))?.vehicleId;
const deferral = (plan: ArcPlan, taskId: number) => plan.deferred.find((d) => d.taskId === taskId);

describe('estimateRouteSec', () => {
  const v: ArcVehicle = { id: 0, x: 0, y: 0, tipX: 0, tipY: 0, payloadKg: 1000, loadKg: 0, availableSec: 1e9, beat: [] };
  const opts = { speedMps: 5, detour: 1.5 };
  const task = { id: 1, x: 300, y: 400, serviceSec: 120, demandKg: 100, priority: 1, mustServe: false, reachable: true, reason: 'beat' as const };

  it('is travel out, service, and the trip to tip', () => {
    expect(estimateRouteSec(opts, v, [task])).toBeCloseTo((500 * 1.5) / 5 + 120 + (500 * 1.5) / 5, 9);
  });

  it('adds a round trip to the transfer point each time the payload fills', () => {
    const heavy = { ...task, demandKg: 1500 };
    expect(estimateRouteSec(opts, v, [heavy])).toBeCloseTo((500 * 1.5) / 5 + 120 + 2 * ((500 * 1.5) / 5) + (500 * 1.5) / 5, 9);
  });

  it('counts the load already on board', () => {
    const half = { ...task, demandKg: 600 };
    expect(estimateRouteSec(opts, { ...v, loadKg: 500 }, [half])).toBeGreaterThan(estimateRouteSec(opts, v, [half]));
  });

  it('is zero work for no tasks', () => {
    expect(estimateRouteSec(opts, v, [])).toBe(0);
  });
});

describe('planArcs', () => {
  it('serves every street when nobody is absent and time is plentiful', () => {
    const input = arcInstance({ cols: 8, rows: 6, vehicles: 4 });
    const plan = planArcs(input);
    expect(validateArcPlan(input, plan)).toEqual([]);
    expect(plan.deferred).toEqual([]);
    expect(plan.routes.flatMap((r) => r.tasks)).toHaveLength(48);
  });

  it('shares an absent tipper’s beat among the tippers whose beats border it', () => {
    const o = { cols: 8, rows: 6, vehicles: 4, absent: [1] };
    // The warm start hands each orphan street to a bordering beat; local search may then pass streets on to a
    // further tipper when that shortens total driving (M3-D6 step 4, §10.10).
    const warm = planArcs(arcInstance({ ...o, budget: 0 }));
    for (const t of arcInstance(o).orphans) {
      expect(staticBeatOwner(o, t)).toBe(1);
      expect([0, 2]).toContain(routeOf(warm, t));
    }
    const input = arcInstance(o);
    const plan = planArcs(input);
    expect(validateArcPlan(input, plan)).toEqual([]);
    expect(plan.deferred).toEqual([]);
    for (const t of input.orphans) expect([0, 2, 3]).toContain(routeOf(plan, t));
    expect(plan.routes.find((r) => r.vehicleId === 1)).toBeUndefined();
  });

  it('keeps every route within its tipper’s time, deferring low-priority streets', () => {
    const input = arcInstance({ cols: 8, rows: 6, vehicles: 4, absent: [1, 2], availableSec: 2400 });
    const plan = planArcs(input);
    expect(validateArcPlan(input, plan)).toEqual([]);
    const byId = new Map(input.tasks.map((t) => [t.id, t]));
    for (const r of plan.routes) {
      const v = input.vehicles.find((x) => x.id === r.vehicleId)!;
      expect(estimateRouteSec(input, v, r.tasks.map((id) => byId.get(id)!))).toBeLessThanOrEqual(v.availableSec);
    }
    expect(plan.deferred.length).toBeGreaterThan(0);
    for (const d of plan.deferred) expect(d.reason).toBe('lowBacklog');
    // What was kept outranks what was deferred, on average.
    const mean = (ids: readonly number[]): number => ids.reduce((a, id) => a + byId.get(id)!.priority, 0) / Math.max(1, ids.length);
    expect(mean(plan.routes.flatMap((r) => r.tasks))).toBeGreaterThan(mean(plan.deferred.map((d) => d.taskId)));
  });

  it('never defers a must-serve street while a tipper has time for it', () => {
    const must = [0, 7, 40, 47, 20, 27];
    const input = arcInstance({ cols: 8, rows: 6, vehicles: 4, absent: [1, 2], availableSec: 2400, mustServe: must });
    const plan = planArcs(input);
    expect(validateArcPlan(input, plan)).toEqual([]);
    for (const t of must) expect(routeOf(plan, t), `task ${t}`).toBeDefined();
  });

  it('defers must-serve streets as `capacity` only when no tipper has the time', () => {
    const must = [0, 1, 2, 3, 4, 5, 6, 7];
    const input = arcInstance({ cols: 8, rows: 6, vehicles: 2, availableSec: 400, mustServe: must });
    const plan = planArcs(input);
    expect(validateArcPlan(input, plan)).toEqual([]);
    const deferredMust = plan.deferred.filter((d) => must.includes(d.taskId));
    expect(deferredMust.length).toBeGreaterThan(0);
    for (const d of deferredMust) expect(d.reason).toBe('capacity');
  });

  it('defers streets cut off by closures as `closed`, whatever their priority', () => {
    const input = arcInstance({ cols: 8, rows: 6, vehicles: 4, closed: [9, 10], mustServe: [10] });
    const plan = planArcs(input);
    expect(deferral(plan, 9)?.reason).toBe('closed');
    expect(deferral(plan, 10)?.reason).toBe('closed');
    expect(routeOf(plan, 9)).toBeUndefined();
  });

  it('is deterministic', () => {
    const input = arcInstance({ cols: 10, rows: 8, vehicles: 5, absent: [2], availableSec: 5000 });
    expect(planArcs(input)).toEqual(planArcs(input));
  });

  it('stays within the iteration budget, and with no budget returns the warm start', () => {
    const input = arcInstance({ cols: 10, rows: 8, vehicles: 5, absent: [2], budget: 300 });
    const plan = planArcs(input);
    expect(plan.iterations).toBeLessThanOrEqual(300);
    const none = planArcs({ ...input, budget: 0 });
    expect(none.iterations).toBe(0);
    expect(none.cost).toBe(none.warmCost);
    expect(validateArcPlan(input, none)).toEqual([]);
  });

  it('is never worse than its warm start', () => {
    for (const absent of [[], [0], [1, 3]]) {
      const plan = planArcs(arcInstance({ cols: 10, rows: 8, vehicles: 5, absent, availableSec: 6000 }));
      expect(plan.cost).toBeLessThanOrEqual(plan.warmCost + 1e-9);
    }
  });
});

describe('validateArcPlan', () => {
  const input = arcInstance({ cols: 4, rows: 2, vehicles: 2 });

  it('reports a street served twice, a street missing, and an unknown tipper', () => {
    const bad: ArcPlan = {
      routes: [
        { vehicleId: 0, tasks: [0, 1, 2] },
        { vehicleId: 1, tasks: [2, 3, 4, 5, 6] },
        { vehicleId: 9, tasks: [] },
      ],
      deferred: [],
      iterations: 0,
      cost: 0,
      warmCost: 0,
    };
    const problems = validateArcPlan(input, bad).join('\n');
    expect(problems).toMatch(/task 2 .*twice/i);
    expect(problems).toMatch(/task 7 .*missing/i);
    expect(problems).toMatch(/vehicle 9/i);
  });

  it('reports a route over its tipper’s time', () => {
    const tight = arcInstance({ cols: 4, rows: 2, vehicles: 2, availableSec: 10 });
    const plan: ArcPlan = { routes: [{ vehicleId: 0, tasks: [0, 1, 2, 3, 4, 5, 6, 7] }], deferred: [], iterations: 0, cost: 0, warmCost: 0 };
    expect(validateArcPlan(tight, plan).join('\n')).toMatch(/vehicle 0 .*time/i);
  });
});
