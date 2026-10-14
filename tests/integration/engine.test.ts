import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { SnapshotFiles } from '../../src/geo/snapshot';
import { TRACKER_STEPS } from '../../src/sim/world';
import { SimEngine } from '../../src/workers/engine';
import type { FromSim } from '../../src/workers/protocol';

// Each test builds two real-cluster worlds (live and twin), which is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 30_000 });

// Architecture M2-3 and M2-15: the live engine runs the shadow twin and publishes the dashboard (real snapshot).

type Dashboard = Extract<FromSim, { type: 'dashboard' }>;

function files(): SnapshotFiles {
  const root = resolve(import.meta.dirname, '../../data/snapshot');
  const dir = join(root, readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop()!);
  const bin = (n: string): Uint8Array => new Uint8Array(readFileSync(join(dir, n)));
  const txt = (n: string): string => readFileSync(join(dir, n), 'utf8');
  return { 'manifest.json': txt('manifest.json'), 'roads.bin': bin('roads.bin'), 'buildings.bin': bin('buildings.bin'), 'areas.bin': bin('areas.bin'), 'wards.json': txt('wards.json'), 'pois.json': txt('pois.json') };
}

function engineAt(secondOfDay: number): SimEngine {
  const engine = new SimEngine();
  const out = engine.handle({ type: 'init', files: files(), seed: 20_261_014, startDate: '2026-10-14', startAtSec: secondOfDay });
  expect(out.some((m) => m.type === 'ready')).toBe(true);
  return engine;
}

/** Ticks until a dashboard message arrives (at most 10 ticks of 0.25 s). */
function nextDashboard(engine: SimEngine): Dashboard {
  for (let i = 0; i < 10; i++) {
    const d = engine.tick(0.25).find((m): m is Dashboard => m.type === 'dashboard');
    if (d) return d;
  }
  throw new Error('no dashboard message within 2.5 s');
}

describe('engine start-up', () => {
  it('answers init with ready and the first frame, and sends no building geometry (CR-1)', () => {
    const engine = new SimEngine();
    const out = engine.handle({ type: 'init', files: files(), seed: 20_261_014, startDate: '2026-10-14', startAtSec: 8 * 3600 });
    expect(out.map((m) => m.type)).toEqual(['ready', 'frame']);
  });
});

describe('engine dashboard', () => {
  it('publishes KPIs for the live world and its twin in lockstep, and the three tables', () => {
    const engine = engineAt(8 * 3600);
    const d = nextDashboard(engine);
    expect(d.weather).toBe('clear');
    expect(d.kpis.twin.t).toBe(d.kpis.live.t);
    expect(d.kpis.live.t).toBe(d.t);
    expect(d.tables.bins).toHaveLength(120);
    expect(d.tables.fleet).toHaveLength(73);
    expect(d.tables.routes).toHaveLength(65);
    for (const r of d.tables.routes) expect(r.routeId).toMatch(/^R-2026-10-14-\d{3}$/);
    for (const b of d.tables.bins) expect(b.ward.length).toBeGreaterThan(0);
    expect(Object.keys(d.tracker.counts).sort()).toEqual([...TRACKER_STEPS].sort());
    expect(d.tracker.selection).toBeNull();
    expect(d.kpis.trend.overflowing.length).toBeLessThanOrEqual(24);
  });

  it('applies weather to both worlds (M3-2), so with both on Static the twin matches the live world', () => {
    const engine = engineAt(6 * 3600);
    expect(engine.handle({ type: 'setWeather', weather: 'monsoon' }).some((m) => m.type === 'error')).toBe(false);
    engine.handle({ type: 'skipTo', secondOfDay: 11 * 3600, reqId: 1 });
    const d = nextDashboard(engine);
    expect(d.weather).toBe('monsoon');
    expect(d.policy).toBe('static');
    expect(d.kpis.live).toEqual(d.kpis.twin);
  });

  it('switches the live world to Dynamic (M3-1): the twin stays Static and the tables show the policy', () => {
    const engine = engineAt(5 * 3600);
    expect(engine.handle({ type: 'setPolicy', policy: 'dynamic' }).some((m) => m.type === 'error')).toBe(false);
    engine.handle({ type: 'skipTo', secondOfDay: 12 * 3600, reqId: 1 });
    const d = nextDashboard(engine);
    expect(d.policy).toBe('dynamic');
    const tippers = d.tables.routes;
    expect(tippers.length).toBeGreaterThan(0);
    for (const r of tippers) expect(r.policy).toBe('dynamic');
    expect(tippers.some((r) => r.replans > 0)).toBe(true);
    expect(d.kpis.live).not.toEqual(d.kpis.twin);
    expect(d.forecastMae).not.toBeNull();
    expect(d.forecastMae!).toBeGreaterThanOrEqual(0);
  });

  it('rejects an unknown policy', () => {
    const engine = engineAt(6 * 3600);
    const out = engine.handle({ type: 'setPolicy', policy: 'chaotic' as 'static' });
    expect(out.some((m) => m.type === 'error')).toBe(true);
  });

  it('explains a selected tipper’s route in its detail message (M3-10)', () => {
    const engine = engineAt(5 * 3600);
    engine.handle({ type: 'setPolicy', policy: 'dynamic' });
    engine.handle({ type: 'skipTo', secondOfDay: 9 * 3600, reqId: 1 });
    const detail = engine.handle({ type: 'select', vehicleId: 0 }).find((m) => m.type === 'detail');
    expect(detail?.type === 'detail' && detail.explain?.policy).toBe('dynamic');
  });

  it('follows a selected bin in the tracker and reports new alerts', () => {
    const engine = engineAt(5 * 3600);
    engine.handle({ type: 'selectObject', target: { kind: 'bin', id: 0 } });
    engine.handle({ type: 'skipTo', secondOfDay: 12 * 3600, reqId: 1 });
    const d = nextDashboard(engine);
    expect(d.tracker.selection).toEqual({ kind: 'bin', id: 0 });
    expect(d.tracker.timeline?.map((s) => s.step)).toEqual([...TRACKER_STEPS]);
    expect(d.alerts.length).toBeGreaterThan(0);
    const next = nextDashboard(engine);
    const ids = new Set(d.alerts.map((a) => a.id));
    expect(next.alerts.every((a) => !ids.has(a.id))).toBe(true);
  });

  it('rejects an unknown weather mode', () => {
    const engine = engineAt(6 * 3600);
    const out = engine.handle({ type: 'setWeather', weather: 'snow' as 'clear' });
    expect(out).toEqual([expect.objectContaining({ type: 'error' })]);
  });
});
