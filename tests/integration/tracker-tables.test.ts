import { describe, expect, it } from 'vitest';
import { DAY_SEC, at } from '../../src/sim/clock';
import type { SimEvent } from '../../src/sim/events';
import {
  TRACKER_STEPS,
  binRows,
  binTimeline,
  createWorld,
  drainEvents,
  fleetRows,
  routeRows,
  runUntil,
  stepCountsToday,
  transferPointTimeline,
  vehicleTimeline,
  type Timeline,
} from '../../src/sim/world';
import { buildTown, townConfig, townSpec } from '../fixtures/town';

// Requirements D-5, D-6 and architecture M2-8, M2-9: the process tracker and the live tables.

function ordered(tl: Timeline): boolean {
  let last = -Infinity;
  for (const s of tl) {
    if (s.at === null) continue;
    if (s.at < last) return false;
    last = s.at;
  }
  return true;
}

describe('process tracker', () => {
  it('follows a bin from its reading to KCDC, in order', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(world, at(0, 23, 0));
    const tl = binTimeline(world, 0);
    expect(tl.map((s) => s.step)).toEqual([...TRACKER_STEPS]);
    expect(tl.every((s) => s.at !== null)).toBe(true);
    expect(ordered(tl)).toBe(true);
    // Fill reported is the last reading at or before routing (the shift start).
    expect(tl[0]!.at! % 900).toBe(0);
    expect(tl[0]!.at!).toBeLessThanOrEqual(tl[1]!.at!);
  });

  it('shows the oldest batch waiting at a transfer point, and what a tipper carries mid-beat', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(world, at(0, 8, 0));
    const carrying = [0, 1, 2, 3].map((id) => vehicleTimeline(world, id)).filter((tl) => tl[3]!.at !== null);
    expect(carrying.length).toBeGreaterThan(0);
    for (const tl of carrying) {
      expect(tl[4]!.at).toBeNull();
      expect(ordered(tl)).toBe(true);
    }
    runUntil(world, at(0, 11, 0));
    const waiting = [0, 1].map((id) => transferPointTimeline(world, id));
    for (const tl of waiting) {
      if (tl[4]!.at === null) continue;
      expect(tl[5]!.at).toBeNull();
      expect(ordered(tl)).toBe(true);
    }
    expect(transferPointTimeline(createWorld(buildTown(), townConfig(), townSpec()), 0).every((s) => s.at === null)).toBe(true);
  });

  it('counts today’s steps when nothing is selected', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(world, at(0, 23, 59));
    const events = drainEvents(world);
    const count = (kind: SimEvent['kind']): number => events.filter((e) => e.kind === kind).length;
    const c = stepCountsToday(world);
    expect(c['Fill reported']).toBe(count('SensorReading'));
    expect(c.Routed).toBe(64);
    expect(c['Vehicle en route']).toBe(0);
    expect(c.Collected).toBe(count('StopServed'));
    expect(c.Transferred).toBe(count('Tipped'));
    expect(c.Processed).toBe(count('Unloaded'));
  });
});

describe('live tables', () => {
  it('has a row per bin, per vehicle and per beat', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(world, at(0, 8, 0));
    expect(binRows(world)).toHaveLength(4);
    expect(fleetRows(world)).toHaveLength(7);
    const routes = routeRows(world);
    expect(routes.map((r) => r.vehicleId)).toEqual([0, 1, 2, 3]);
    for (const r of routes) {
      expect(r.stopsPlanned).toBeGreaterThan(0);
      expect(r.stopsDone).toBeLessThanOrEqual(r.stopsPlanned);
      expect(r.kmPlanned).toBeGreaterThan(0);
      expect(r.deviations).toBe(0);
      if (r.stopsDone < r.stopsPlanned) expect(r.etaAt!).toBeGreaterThan(at(0, 8, 0));
    }
    const bins = binRows(world);
    // Sensors fail now and then (by design), so a working sensor has a reading; any status is valid.
    for (const b of bins) {
      expect(['ok', 'stuck', 'offline']).toContain(b.sensorStatus);
      if (b.sensorStatus === 'ok') expect(b.reportedPct).not.toBeNull();
    }
    expect(bins.some((b) => b.reportedPct !== null)).toBe(true);
    const fleet = fleetRows(world);
    expect(fleet.filter((f) => f.kind === 'auto-tipper' && f.state !== 'OffShift').length).toBe(4);
  });

  it('shows finished beats at the end of the day', () => {
    const world = createWorld(buildTown(), townConfig(), townSpec());
    runUntil(world, DAY_SEC - 60);
    for (const r of routeRows(world)) {
      expect(r.stopsDone).toBe(r.stopsPlanned);
      expect(r.kmActual).toBeGreaterThan(0);
      expect(r.etaAt).toBeNull();
    }
    for (const b of binRows(world)) expect(b.lastServicedAt).not.toBeNull();
  });
});
