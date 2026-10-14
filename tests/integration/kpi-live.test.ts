import { describe, expect, it } from 'vitest';
import { DAY_SEC, at } from '../../src/sim/clock';
import type { SimEvent } from '../../src/sim/events';
import type { MapData } from '../../src/sim/map-data';
import { createWorld, drainEvents, massBalance, runUntil, vehicleViews, worldKpis } from '../../src/sim/world';
import { buildTown, townConfig, townSpec } from '../fixtures/town';

// Requirements D-3, K-1 to K-3 and architecture M2-1: today's KPIs, reset at midnight.

describe('worldKpis', () => {
  it('starts the day at zero', () => {
    const k = worldKpis(createWorld(buildTown(), townConfig(), townSpec()));
    expect(k.t).toBe(0);
    expect(k.overflowHoursToday).toBe(0);
    expect(k.fuel).toEqual({ litresToday: 0, tonnesDeliveredToday: 0, perTonne: null, costInr: 0 });
    expect(k.coverage).toEqual({ pct: null, onTime: 0, scheduled: 0 });
    expect(k.tonnes).toEqual({ generatedToday: 0, collectedToday: 0 });
  });

  it('accounts for a whole day consistently with the event stream', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    const end = at(0, 23, 59);
    runUntil(world, end);
    const events = drainEvents(world);
    const k = worldKpis(world);
    // Fuel: the fleet's litres, over tonnes collected today (M3-12; it was tonnes delivered until M2), priced at ₹89/L.
    const litres = vehicleViews(world).reduce((a, v) => a + v.fuelLitresToday, 0);
    const delivered = events.filter((e): e is Extract<SimEvent, { kind: 'Unloaded' }> => e.kind === 'Unloaded').reduce((a, e) => a + e.kg, 0) / 1000;
    expect(k.fuel.litresToday).toBeCloseTo(litres, 6);
    expect(k.fuel.tonnesDeliveredToday).toBeCloseTo(delivered, 6);
    expect(k.fuel.perTonne).toBeCloseTo(litres / k.tonnes.collectedToday, 6);
    expect(k.tonnes.collectedToday).not.toBeCloseTo(delivered, 3);
    expect(k.fuel.costInr).toBeCloseTo(litres * 89, 3);
    // Coverage: 60 beat segments and the 4 bins on the beats, all served in the shift, plus a clearance job for each
    // black spot that activated (served if cleared the same day, within 24 h).
    const activated = events.filter((e) => e.kind === 'BlackSpotActivated').length;
    const cleared = events.filter((e) => e.kind === 'BlackSpotCleared').length;
    expect(k.coverage.scheduled).toBe(64 + activated);
    expect(k.coverage.onTime).toBe(64 + cleared);
    expect(k.coverage.pct).toBeCloseTo((100 * (64 + cleared)) / (64 + activated), 9);
    // Tonnes: generated matches the mass balance; collected matches the stops served from streets and bins.
    expect(k.tonnes.generatedToday).toBeCloseTo(massBalance(world).generatedKg / 1000, 6);
    const collected = events.filter((e): e is Extract<SimEvent, { kind: 'StopServed' }> => e.kind === 'StopServed').reduce((a, e) => a + e.kg, 0) / 1000;
    expect(k.tonnes.collectedToday).toBeCloseTo(collected, 6);
  });

  it('resets at midnight', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(world, DAY_SEC + 60);
    const k = worldKpis(world);
    expect(k.fuel.litresToday).toBe(0);
    expect(k.fuel.tonnesDeliveredToday).toBe(0);
    expect(k.coverage.scheduled).toBe(0);
    expect(k.overflowHoursToday).toBe(0);
    expect(k.tonnes.generatedToday).toBeGreaterThan(0);
    expect(k.tonnes.generatedToday).toBeLessThan(0.01);
  });

  it('integrates overflow-hours at each 15-minute sensor round', () => {
    const town = buildTown();
    const map: MapData = { ...town, bins: [{ ...town.bins[0]!, dailyKg: 100_000, capacityKg: 10 }] };
    const world = createWorld(map, townConfig(), townSpec());
    runUntil(world, 3600);
    const k = worldKpis(world);
    expect(k.overflowing.binsFull).toBe(1);
    expect(k.overflowing.total).toBe(1 + k.overflowing.blackSpotsActive);
    // Full at every round from the first: 4 rounds × 0.25 h.
    expect(k.overflowHoursToday).toBeCloseTo(1, 9);
  });

  it('counts active black spots as overflowing points', () => {
    const world = createWorld(buildTown(), townConfig({ blackSpotBaseChancePerHour: 0.9 }), townSpec({ levers: { tipperAbsenceRate: 1, breakdownChancePerShift: 0, skipChance: 0 } }));
    runUntil(world, at(0, 12, 0));
    const k = worldKpis(world);
    expect(k.overflowing.blackSpotsActive).toBeGreaterThan(0);
    expect(k.overflowing.total).toBe(k.overflowing.binsFull + k.overflowing.blackSpotsActive);
  });
});
