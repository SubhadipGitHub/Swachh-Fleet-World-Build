import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGraph, type RoadGraph } from '../../src/routing/graph';
import { DEFAULT_TRAFFIC_PARAMS, addVehicle, createTraffic, positions, reservations, stepTraffic } from '../../src/sim/movement/traffic';
import { gridNetwork } from '../fixtures/grid';

// Requirements L-4 and architecture AD-6: on random grids with many vehicles, nobody overlaps, every junction
// reservation is short-lived and exclusive, and everybody arrives (no deadlock).

/** A random walk of `steps` edges from a start node, never making an immediate U-turn when another way exists. */
function randomWalk(g: RoadGraph, start: number, steps: number, pick: (n: number) => number): number[] {
  const route: number[] = [];
  let node = start;
  let prev = -1;
  for (let i = 0; i < steps; i++) {
    const out: number[] = [];
    for (let e = g.firstOut[node]!; e < g.firstOut[node + 1]!; e++) if (e !== (prev >= 0 ? g.edgeTwin[prev] : -2)) out.push(e);
    if (out.length === 0) break;
    const e = out[pick(out.length)]!;
    route.push(e);
    prev = e;
    node = g.edgeTo[e]!;
  }
  return route;
}

const scenario = fc.record({
  cols: fc.integer({ min: 3, max: 6 }),
  rows: fc.integer({ min: 3, max: 6 }),
  vehicles: fc.array(
    fc.record({
      start: fc.nat(),
      steps: fc.integer({ min: 1, max: 12 }),
      choices: fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
      departAt: fc.integer({ min: 0, max: 120 }),
      lengthM: fc.constantFrom(4, 6, 9),
    }),
    { minLength: 1, maxLength: 40 },
  ),
});

describe('lane queues on random grids', () => {
  it('never overlap, keep reservations exclusive and brief, and always arrive', () => {
    fc.assert(
      fc.property(scenario, ({ cols, rows, vehicles }) => {
        const g = buildGraph(gridNetwork(cols, rows, 60));
        const tr = createTraffic(g, (e) => g.edgeFreeSpeedMps[e]!);
        const lengths = new Map<number, number>();
        let freeFlowTotal = 0;
        vehicles.forEach((v, id) => {
          let c = 0;
          const route = randomWalk(g, v.start % g.nodeCount, v.steps, (n) => v.choices[c++ % v.choices.length]! % n);
          if (route.length === 0) return;
          addVehicle(tr, { id, lengthM: v.lengthM, route, departAt: v.departAt });
          lengths.set(id, v.lengthM);
          freeFlowTotal += route.reduce((s, e) => s + g.edgeLengthM[e]! / g.edgeFreeSpeedMps[e]!, 0);
        });

        const horizon = 120 + 3 * freeFlowTotal + 600;
        const arrived = new Set<number>();
        const heldSince = new Map<number, { vehicle: number; since: number }>();
        for (let t = 0; t < horizon && arrived.size < lengths.size; t++) {
          for (const ev of stepTraffic(tr, t, 1)) if (ev.kind === 'Arrived') arrived.add(ev.id);

          const ps = positions(tr);
          for (const p of ps) {
            expect(p.s).toBeGreaterThanOrEqual(-1e-6);
            expect(p.s).toBeLessThanOrEqual(g.edgeLengthM[p.edge]! + 1e-6);
            expect(p.lane).toBeLessThan(g.edgeLanes[p.edge]!);
          }
          for (const a of ps) {
            for (const b of ps) {
              if (a.id === b.id || a.edge !== b.edge || a.lane !== b.lane || a.s < b.s || (a.s === b.s && a.id > b.id)) continue;
              expect(b.s).toBeLessThanOrEqual(a.s - lengths.get(a.id)! - DEFAULT_TRAFFIC_PARAMS.minGapM + 1e-6);
            }
          }

          const res = reservations(tr);
          for (const [node, vehicle] of res) {
            expect(lengths.has(vehicle)).toBe(true);
            const held = heldSince.get(node);
            if (!held || held.vehicle !== vehicle) heldSince.set(node, { vehicle, since: t });
            else expect(t - held.since).toBeLessThanOrEqual(60);
          }
          for (const node of [...heldSince.keys()]) if (!res.has(node)) heldSince.delete(node);
        }
        expect(arrived.size).toBe(lengths.size);
      }),
      { numRuns: 60 },
    );
  });

  it('is deterministic', () => {
    const run = (): string => {
      const g = buildGraph(gridNetwork(4, 4, 60));
      const tr = createTraffic(g, (e) => g.edgeFreeSpeedMps[e]!);
      for (let id = 0; id < 12; id++) {
        let c = id;
        addVehicle(tr, { id, lengthM: 6, route: randomWalk(g, id % g.nodeCount, 8, (n) => c++ % n), departAt: id * 3 });
      }
      const log: unknown[] = [];
      for (let t = 0; t < 400; t++) log.push(stepTraffic(tr, t, 1), positions(tr));
      return JSON.stringify(log);
    };
    expect(run()).toBe(run());
  });
});
