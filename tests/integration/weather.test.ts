import { describe, expect, it } from 'vitest';
import { DAY_SEC, at } from '../../src/sim/clock';
import { accumulatedKg, defaultProfiles } from '../../src/sim/generation';
import type { SimEvent } from '../../src/sim/events';
import type { MapData } from '../../src/sim/map-data';
import { closedEdges, createWorld, currentWeather, drainEvents, massBalance, runUntil, setWeather, vehicleViews, vehicles, worldKpis } from '../../src/sim/world';
import { buildFloodTown, buildTown, townConfig, townSpec } from '../fixtures/town';

// Requirements X-1 and architecture M2-4, M2-5: weather changes the live world from the moment it is set.

const total = (b: ReturnType<typeof massBalance>): number => b.uncollectedKg + b.onVehiclesKg + b.atTransferPointsKg + b.deliveredKcdcKg + b.deliveredLandfillKg;

describe('monsoon downpour', () => {
  it('closes flood-prone streets: their stops are skipped, nobody drives onto them, and the books balance', () => {
    const map = buildFloodTown();
    const closed = new Set(map.floodProneSpots[0]!.edges);
    const world = createWorld(map, townConfig(), townSpec());
    setWeather(world, 'monsoon');
    expect(currentWeather(world)).toBe('monsoon');
    expect(closedEdges(world)).toEqual([...closed].sort((a, b) => a - b));
    const events: SimEvent[] = [];
    for (let t = 300; t <= DAY_SEC; t += 300) {
      runUntil(world, t);
      events.push(...drainEvents(world));
      for (const v of vehicleViews(world)) expect(closed.has(v.edge), `${v.kind} ${v.id} at ${t}`).toBe(false);
    }
    expect(events.some((e) => e.kind === 'RoadClosed')).toBe(true);
    const closedSegments = new Set(map.segments.filter((s) => s.edges.some((e) => closed.has(e))).map((s) => s.id));
    const served = events.filter((e): e is Extract<SimEvent, { kind: 'StopServed' }> => e.kind === 'StopServed' && e.target.type === 'segment');
    expect(served.some((e) => closedSegments.has(e.target.id))).toBe(false);
    const skipped = events.filter((e): e is Extract<SimEvent, { kind: 'StopSkipped' }> => e.kind === 'StopSkipped' && e.reason === 'road-closed');
    expect(new Set(skipped.map((e) => e.target.id))).toEqual(closedSegments);
    const balance = massBalance(world);
    expect(total(balance)).toBeCloseTo(balance.generatedKg, 3);
    for (const v of vehicles(world)) expect(v.state).toBe(v.kind === 'crew' ? 'Idle' : 'OffShift');
  });

  it('reopens the streets when the rain stops', () => {
    const world = createWorld(buildFloodTown(), townConfig(), townSpec());
    setWeather(world, 'monsoon');
    runUntil(world, 3600);
    setWeather(world, 'clear');
    expect(closedEdges(world)).toEqual([]);
    runUntil(world, 3601);
    expect(drainEvents(world).some((e) => e.kind === 'RoadReopened')).toBe(true);
  });

  it('adds 9% to generation only from the moment it starts', () => {
    const clear = createWorld(buildTown(), townConfig(), townSpec());
    const wet = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(clear, at(0, 12, 0));
    runUntil(wet, at(0, 12, 0));
    expect(massBalance(wet).generatedKg).toBeCloseTo(massBalance(clear).generatedKg, 6);
    setWeather(wet, 'monsoon');
    runUntil(clear, DAY_SEC);
    runUntil(wet, DAY_SEC);
    const { household, market } = defaultProfiles();
    const afternoon = 3600 * 1.53 * accumulatedKg(1, household, at(0, 12, 0), DAY_SEC) + 4 * accumulatedKg(120, market, at(0, 12, 0), DAY_SEC);
    expect(massBalance(wet).generatedKg - massBalance(clear).generatedKg).toBeCloseTo(0.09 * afternoon, 3);
  });
});

describe('winter haze and heatwave', () => {
  it('haze and heatwave change the day without breaking the books', () => {
    for (const mode of ['haze', 'heatwave'] as const) {
      const world = createWorld(buildTown(), townConfig(), townSpec());
      setWeather(world, mode);
      runUntil(world, DAY_SEC);
      const b = massBalance(world);
      expect(total(b)).toBeCloseTo(b.generatedKg, 3);
      expect(currentWeather(world)).toBe(mode);
    }
  });

  it('a heatwave counts bins at 90% or more as overflowing', () => {
    // One fast-filling market bin; find the moment its true fill is ~95%.
    const town = buildTown();
    const map: MapData = { ...town, bins: [{ ...town.bins[0]!, dailyKg: 4000, capacityKg: 100 }] };
    const { market } = defaultProfiles();
    let t = 0;
    while (accumulatedKg(4000, market, 0, t) < 95) t += 1;
    expect(t).toBeLessThan(at(0, 6, 0));
    const clear = createWorld(map, townConfig(), townSpec());
    const hot = createWorld(map, townConfig(), townSpec());
    setWeather(hot, 'heatwave');
    runUntil(clear, t);
    runUntil(hot, t);
    expect(worldKpis(clear).overflowing.binsFull).toBe(0);
    expect(worldKpis(hot).overflowing.binsFull).toBe(1);
  });
});
