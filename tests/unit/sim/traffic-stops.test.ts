import { describe, expect, it } from 'vitest';
import { buildGraph, nodeIndex, type RoadGraph } from '../../../src/routing/graph';
import { addVehicle, createTraffic, isIdle, positions, removeVehicle, reroute, reservations, resume, stepTraffic, vehiclePlace, type Traffic, type TrafficEvent } from '../../../src/sim/movement/traffic';

// Service stops, rerouting and bookkeeping used by the world (AD-6, AD-7).

function road(): { g: RoadGraph; route: number[] } {
  const g = buildGraph({
    nodes: [1, 2, 3, 4].map((id) => ({ id, x: (id - 1) * 100, y: 0 })),
    ways: [1, 2, 3].map((i) => ({ id: i, nodes: [i, i + 1], highway: 'residential' as const, oneway: 'no' as const })),
  });
  const route: number[] = [];
  for (let id = 1; id < 4; id++) {
    const a = nodeIndex(g, id);
    for (let e = g.firstOut[a]!; e < g.firstOut[a + 1]!; e++) if (g.edgeTo[e] === nodeIndex(g, id + 1)) route.push(e);
  }
  return { g, route };
}

function run(tr: Traffic, from: number, to: number): TrafficEvent[] {
  const out: TrafficEvent[] = [];
  for (let t = from; t < to; t++) out.push(...stepTraffic(tr, t, 1));
  return out;
}

describe('route stops', () => {
  it('halts exactly at a stop, reports it once, and carries on after resume', () => {
    const { g, route } = road();
    const tr = createTraffic(g, () => 10);
    addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 0 }, [{ routeIdx: 1, s: 50, tag: 42 }]);
    const events = run(tr, 0, 60);
    const reached = events.filter((e) => e.kind === 'ReachedStop');
    expect(reached).toEqual([{ kind: 'ReachedStop', id: 1, tag: 42, t: expect.any(Number) as number }]);
    expect(positions(tr)[0]).toMatchObject({ edge: route[1], s: 50, speedMps: 0 });
    resume(tr, 1);
    expect(run(tr, 60, 120).some((e) => e.kind === 'Arrived')).toBe(true);
  });

  it('fires a stop at s = 0 on departure', () => {
    const { g, route } = road();
    const tr = createTraffic(g, () => 10);
    addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 0 }, [{ routeIdx: 0, s: 0, tag: -1 }]);
    expect(run(tr, 0, 1).map((e) => e.kind)).toEqual(['Departed', 'ReachedStop']);
  });

  it('does not let a short hop jump past a stop on the next edge', () => {
    const { g, route } = road();
    const tr = createTraffic(g, () => 50);
    addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 0 }, [{ routeIdx: 2, s: 1, tag: 7 }]);
    run(tr, 0, 60);
    expect(positions(tr)[0]).toMatchObject({ edge: route[2], s: 1 });
  });
});

describe('passing on a multi-lane road', () => {
  it('gets past a stopped vehicle on a two-lane one-way street by using the free lane', () => {
    const g = buildGraph({
      nodes: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 200, y: 0 },
      ],
      ways: [{ id: 1, nodes: [1, 2], highway: 'primary', oneway: 'yes', lanes: 2 }],
    });
    const edge = g.firstOut[nodeIndex(g, 1)]!;
    const tr = createTraffic(g, () => 10);
    addVehicle(tr, { id: 1, lengthM: 5, route: [edge], departAt: 0 }, [{ routeIdx: 0, s: 60, tag: 1 }]);
    addVehicle(tr, { id: 2, lengthM: 5, route: [edge], departAt: 2 });
    const events = run(tr, 0, 80);
    expect(events.some((e) => e.kind === 'Arrived' && e.id === 2)).toBe(true);
    expect(positions(tr)).toEqual([expect.objectContaining({ id: 1, s: 60 })]);
  });
});

describe('reroute and bookkeeping', () => {
  it('reroutes an active vehicle from its current position', () => {
    const { g, route } = road();
    const tr = createTraffic(g, () => 10);
    addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 0 });
    run(tr, 0, 5);
    const before = positions(tr)[0]!;
    expect(() => {
      reroute(tr, 1, [route[1]!]);
    }).toThrow();
    reroute(tr, 1, [route[0]!]);
    expect(positions(tr)[0]!.s).toBe(before.s);
    const events = run(tr, 5, 30);
    expect(events.filter((e) => e.kind === 'Arrived')).toHaveLength(1);
    expect(vehiclePlace(tr, 1)).toMatchObject({ status: 'arrived', remainingRoute: [] });
  });

  it('counts metres driven and reports idleness', () => {
    const { g, route } = road();
    const tr = createTraffic(g, () => 10);
    expect(isIdle(tr, 0)).toBe(true);
    addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 10 });
    expect(isIdle(tr, 5)).toBe(true);
    expect(isIdle(tr, 10)).toBe(false);
    run(tr, 0, 120);
    expect(vehiclePlace(tr, 1)!.odometerM).toBeCloseTo(300, 6);
    expect(isIdle(tr, 200)).toBe(true);
  });

  it('removes a vehicle and frees its lane and junctions', () => {
    const { g, route } = road();
    const tr = createTraffic(g, () => 10);
    addVehicle(tr, { id: 1, lengthM: 5, route, departAt: 0 });
    addVehicle(tr, { id: 2, lengthM: 5, route, departAt: 999 });
    run(tr, 0, 11);
    removeVehicle(tr, 1);
    removeVehicle(tr, 2);
    removeVehicle(tr, 3);
    expect(positions(tr)).toEqual([]);
    expect(reservations(tr).size).toBe(0);
    expect(vehiclePlace(tr, 1)).toBeNull();
  });
});
