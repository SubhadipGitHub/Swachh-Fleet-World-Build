import { describe, expect, it } from 'vitest';
import { buildGraph, nodeIndex, type RoadGraph } from '../../../src/routing/graph';
import { DEFAULT_TRAFFIC_PARAMS, addVehicle, createTraffic, positions, setStopped, stepTraffic, type Traffic, type TrafficEvent } from '../../../src/sim/movement/traffic';
import type { RoadWay } from '../../../src/geo/snapshot';

// Requirements L-4 ("nothing ever overlaps") and architecture AD-6: fleet lane queues.

/** A straight 300 m road, nodes 1–2–3–4 west to east, 100 m apart. */
function straightRoad(oneway: RoadWay['oneway']): RoadGraph {
  return buildGraph({
    nodes: [1, 2, 3, 4].map((id) => ({ id, x: (id - 1) * 100, y: 0 })),
    ways: [1, 2, 3].map((i) => ({ id: i, nodes: [i, i + 1], highway: 'residential' as const, oneway, lanes: oneway === 'yes' ? 1 : 2 })),
  });
}

function eastbound(g: RoadGraph): number[] {
  const route: number[] = [];
  for (let id = 1; id < 4; id++) {
    const a = nodeIndex(g, id);
    const b = nodeIndex(g, id + 1);
    for (let e = g.firstOut[a]!; e < g.firstOut[a + 1]!; e++) if (g.edgeTo[e] === b) route.push(e);
  }
  return route;
}

const SPEED = 10; // m/s for every edge

function run(tr: Traffic, from: number, to: number, onStep?: (t: number) => void): TrafficEvent[] {
  const events: TrafficEvent[] = [];
  for (let t = from; t < to; t++) {
    events.push(...stepTraffic(tr, t, 1));
    onStep?.(t + 1);
  }
  return events;
}

const arrivalOf = (events: TrafficEvent[], id: number): number | undefined => events.find((e) => e.kind === 'Arrived' && e.id === id)?.t;

describe('traffic on a straight road', () => {
  it('a lone vehicle takes about length ÷ speed, plus acceleration', () => {
    const g = straightRoad('no');
    const tr = createTraffic(g, () => SPEED);
    addVehicle(tr, { id: 1, lengthM: 5, route: eastbound(g), departAt: 0 });
    const events = run(tr, 0, 120);
    const arrived = arrivalOf(events, 1);
    expect(arrived).toBeDefined();
    const ideal = 300 / SPEED;
    expect(arrived!).toBeGreaterThanOrEqual(ideal);
    expect(arrived!).toBeLessThanOrEqual(ideal + SPEED / DEFAULT_TRAFFIC_PARAMS.maxAccelMps2 + 5);
    expect(events.filter((e) => e.kind === 'Arrived' && e.id === 1)).toHaveLength(1);
  });

  it('a vehicle is not on the network before it departs or after it arrives', () => {
    const g = straightRoad('no');
    const tr = createTraffic(g, () => SPEED);
    addVehicle(tr, { id: 1, lengthM: 5, route: eastbound(g), departAt: 30 });
    run(tr, 0, 29);
    expect(positions(tr)).toEqual([]);
    run(tr, 29, 35);
    expect(positions(tr).map((p) => p.id)).toEqual([1]);
    run(tr, 35, 200);
    expect(positions(tr)).toEqual([]);
  });

  it('two vehicles departing together queue without overlapping and arrive in order on a single lane', () => {
    const g = straightRoad('yes');
    const tr = createTraffic(g, () => SPEED);
    addVehicle(tr, { id: 1, lengthM: 6, route: eastbound(g), departAt: 0 });
    addVehicle(tr, { id: 2, lengthM: 6, route: eastbound(g), departAt: 0 });
    const events = run(tr, 0, 200, () => {
      const ps = positions(tr);
      for (const a of ps) {
        for (const b of ps) {
          if (a.id === b.id || a.edge !== b.edge || a.lane !== b.lane || a.s < b.s) continue;
          expect(b.s).toBeLessThanOrEqual(a.s - 6 - DEFAULT_TRAFFIC_PARAMS.minGapM + 1e-6);
        }
      }
    });
    expect(arrivalOf(events, 1)!).toBeLessThan(arrivalOf(events, 2)!);
  });

  it('a stopped service vehicle on a two-way street is passed after the pass delay', () => {
    const g = straightRoad('no');
    const tr = createTraffic(g, () => SPEED);
    addVehicle(tr, { id: 1, lengthM: 5, route: eastbound(g), departAt: 0 });
    addVehicle(tr, { id: 2, lengthM: 5, route: eastbound(g), departAt: 3 });
    run(tr, 0, 8);
    setStopped(tr, 1, true);
    const events = run(tr, 8, 120);
    expect(arrivalOf(events, 2)).toBeDefined();
    expect(arrivalOf(events, 1)).toBeUndefined();
  });

  it('a stopped vehicle on a single-lane one-way street is not passed', () => {
    const g = straightRoad('yes');
    const tr = createTraffic(g, () => SPEED);
    addVehicle(tr, { id: 1, lengthM: 5, route: eastbound(g), departAt: 0 });
    addVehicle(tr, { id: 2, lengthM: 5, route: eastbound(g), departAt: 3 });
    run(tr, 0, 8);
    setStopped(tr, 1, true);
    const events = run(tr, 8, 120);
    expect(arrivalOf(events, 2)).toBeUndefined();
    setStopped(tr, 1, false);
    const later = run(tr, 120, 240);
    expect(arrivalOf(later, 1)!).toBeLessThan(arrivalOf(later, 2)!);
  });

  it('rejects duplicate ids and disconnected or empty routes', () => {
    const g = straightRoad('no');
    const tr = createTraffic(g, () => SPEED);
    const route = eastbound(g);
    addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 0 });
    expect(() => addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 0 })).toThrow();
    expect(() => addVehicle(tr, { id: 2, lengthM: 5, route: [route[0]!, route[2]!], departAt: 0 })).toThrow();
    expect(() => addVehicle(tr, { id: 3, lengthM: 5, route: [], departAt: 0 })).toThrow();
  });
});
