import { describe, expect, it } from 'vitest';
import { planArcs, validateArcPlan } from '../../src/routing/vrp/beats-dynamic';
import { rngFromSeed } from '../../src/shared/rng';
import { arcInstance } from '../fixtures/arcs';

// Architecture M3-D6 and §10.8: random instances always give valid plans that account for every street once.

describe('planArcs on random instances', () => {
  it('plans or defers every street exactly once, within time, with valid reasons', () => {
    const rng = rngFromSeed(42);
    for (let run = 0; run < 40; run++) {
      const cols = rng.int(3, 12);
      const rows = rng.int(2, 8);
      const vehicles = rng.int(1, Math.min(6, cols));
      const absent = Array.from({ length: vehicles }, (_, v) => v).filter(() => rng.chance(0.25));
      const tasks = cols * rows;
      const pick = (p: number): number[] => Array.from({ length: tasks }, (_, t) => t).filter(() => rng.chance(p));
      const input = arcInstance({
        cols,
        rows,
        vehicles,
        absent,
        availableSec: rng.int(300, 8 * 3600),
        mustServe: pick(0.15),
        closed: pick(0.05),
        budget: rng.int(0, 500),
        demandKg: rng.int(10, 400),
      });
      const plan = planArcs(input);
      expect(validateArcPlan(input, plan), `run ${run}`).toEqual([]);
      const seen = [...plan.routes.flatMap((r) => r.tasks), ...plan.deferred.map((d) => d.taskId)].sort((a, b) => a - b);
      expect(seen, `run ${run}`).toEqual(input.tasks.map((t) => t.id).sort((a, b) => a - b));
      for (const d of plan.deferred) {
        const t = input.tasks.find((x) => x.id === d.taskId)!;
        if (!t.reachable) expect(d.reason).toBe('closed');
        else expect(d.reason).toBe(t.mustServe ? 'capacity' : 'lowBacklog');
      }
      expect(plan.iterations).toBeLessThanOrEqual(input.budget);
      if (input.vehicles.length === 0) expect(plan.routes.every((r) => r.tasks.length === 0)).toBe(true);
    }
  });
});
