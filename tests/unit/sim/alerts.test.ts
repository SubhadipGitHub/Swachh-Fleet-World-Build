import { describe, expect, it } from 'vitest';
import { ALERT_SEVERITY, AlertFeed, KCDC_TARGET } from '../../../src/sim/alerts';
import { DAY_SEC } from '../../../src/sim/clock';
import type { SimEvent } from '../../../src/sim/events';

// Requirements D-8 and architecture M2-10: alert rules, de-duplication and re-arming.

const reading = (t: number, binId: number, fillPct: number | null, status: 'ok' | 'stuck' | 'offline' = fillPct === null ? 'offline' : 'ok'): SimEvent => ({
  t,
  kind: 'SensorReading',
  binId,
  fillPct,
  status,
});
const skip = (t: number, vehicleId: number): SimEvent => ({ t, kind: 'StopSkipped', vehicleId, target: { type: 'segment', id: t }, reason: 'non-compliance' });

describe('AlertFeed', () => {
  it('raises bin-high at 90% and bin-overflow at 100% once per fill cycle, re-arming below 50%', () => {
    const feed = new AlertFeed();
    const raised = feed.ingest([reading(900, 3, 85), reading(1800, 3, 91), reading(2700, 3, 95), reading(3600, 3, 100), reading(4500, 3, 100), reading(5400, 3, 40), reading(6300, 3, 92)]);
    expect(raised.map((a) => [a.kind, a.t, a.severity, a.target])).toEqual([
      ['bin-high', 1800, 'warning', { type: 'bin', id: 3 }],
      ['bin-overflow', 3600, 'critical', { type: 'bin', id: 3 }],
      ['bin-high', 6300, 'warning', { type: 'bin', id: 3 }],
    ]);
  });

  it('tracks bins independently', () => {
    const feed = new AlertFeed();
    expect(feed.ingest([reading(900, 1, 95), reading(900, 2, 95)]).map((a) => a.target.id)).toEqual([1, 2]);
  });

  it('raises sensor-offline once per offline spell', () => {
    const feed = new AlertFeed();
    const raised = feed.ingest([reading(900, 4, null), reading(1800, 4, null), reading(2700, 4, 30), reading(3600, 4, null)]);
    expect(raised.map((a) => [a.kind, a.t])).toEqual([
      ['sensor-offline', 900],
      ['sensor-offline', 3600],
    ]);
    expect(raised[0]!.severity).toBe('info');
  });

  it('raises black-spot, breakdown, deviation and road-closed on every event', () => {
    const feed = new AlertFeed();
    const raised = feed.ingest([
      { t: 10, kind: 'BlackSpotActivated', blackSpotId: 2 },
      { t: 20, kind: 'BlackSpotActivated', blackSpotId: 2 },
      { t: 30, kind: 'BrokenDown', vehicleId: 7 },
      { t: 40, kind: 'RouteDeviation', vehicleId: 7 },
      { t: 50, kind: 'RoadClosed', spotId: 1, edges: [4, 5] },
      { t: 60, kind: 'Repaired', vehicleId: 7 },
    ]);
    expect(raised.map((a) => [a.kind, a.target])).toEqual([
      ['black-spot', { type: 'blackSpot', id: 2 }],
      ['black-spot', { type: 'blackSpot', id: 2 }],
      ['breakdown', { type: 'vehicle', id: 7 }],
      ['deviation', { type: 'vehicle', id: 7 }],
      ['road-closed', { type: 'floodSpot', id: 1 }],
    ]);
  });

  it('raises absent once per vehicle per day', () => {
    const feed = new AlertFeed();
    const raised = feed.ingest([
      { t: 21_600, kind: 'VehicleAbsent', vehicleId: 5 },
      { t: 21_600, kind: 'VehicleAbsent', vehicleId: 5 },
      { t: DAY_SEC + 21_600, kind: 'VehicleAbsent', vehicleId: 5 },
    ]);
    expect(raised.map((a) => a.t)).toEqual([21_600, DAY_SEC + 21_600]);
  });

  it('raises skips at a vehicle’s third skip of the day, once per day', () => {
    const feed = new AlertFeed();
    const raised = feed.ingest([skip(100, 1), skip(200, 1), skip(250, 2), skip(300, 1), skip(400, 1), skip(DAY_SEC + 1, 1), skip(DAY_SEC + 2, 1), skip(DAY_SEC + 3, 1)]);
    expect(raised.map((a) => [a.kind, a.t, a.target.id])).toEqual([
      ['skips', 300, 1],
      ['skips', DAY_SEC + 3, 1],
    ]);
  });

  it('raises kcdc-cap at the first diversion of each day', () => {
    const feed = new AlertFeed();
    const raised = feed.ingest([
      { t: 40_000, kind: 'Diverted', vehicleId: 66, kg: 5000 },
      { t: 50_000, kind: 'Diverted', vehicleId: 67, kg: 5000 },
      { t: DAY_SEC + 40_000, kind: 'Diverted', vehicleId: 66, kg: 5000 },
    ]);
    expect(raised.map((a) => [a.kind, a.t, a.target, a.severity])).toEqual([
      ['kcdc-cap', 40_000, KCDC_TARGET, 'critical'],
      ['kcdc-cap', DAY_SEC + 40_000, KCDC_TARGET, 'critical'],
    ]);
  });

  it('numbers alerts from 1, lists newest first, and keeps at most `max`', () => {
    const feed = new AlertFeed(3);
    feed.ingest([1, 2, 3, 4, 5].map((t) => ({ t, kind: 'BrokenDown', vehicleId: t }) as const));
    const list = feed.list();
    expect(list.map((a) => a.id)).toEqual([5, 4, 3]);
    expect(feed.ingest([])).toEqual([]);
  });

  it('ignores events that are not alerts', () => {
    const feed = new AlertFeed();
    expect(feed.ingest([{ t: 1, kind: 'ShiftStarted', vehicleId: 1 }, { t: 2, kind: 'Tipped', vehicleId: 1, transferPointId: 0, kg: 300 }])).toEqual([]);
  });

  it('has a severity for every kind', () => {
    expect(Object.keys(ALERT_SEVERITY).sort()).toEqual(
      ['absent', 'bin-high', 'bin-overflow', 'black-spot', 'breakdown', 'deviation', 'kcdc-cap', 'road-closed', 'sensor-offline', 'skips', 'replanned', 'plan-failed', 'fairness'].sort(),
    );
  });
});

// M3-D10: plan alerts.
describe('AlertFeed plan alerts (M3)', () => {
  const replanned = (t: number, cause: 'daily' | 'breakdown' | 'closure' | 'policy', vehicleIds: number[], deferredMustServe = 0): SimEvent => ({ t, kind: 'Replanned', cause, vehicleIds, deferredMustServe });

  it('raises an info alert for an incident re-plan, naming its cause and the first tipper affected', () => {
    const raised = new AlertFeed().ingest([replanned(30_000, 'breakdown', [2, 0])]);
    expect(raised.map((a) => [a.kind, a.severity, a.target, a.detail])).toEqual([['replanned', 'info', { type: 'vehicle', id: 2 }, 'breakdown']]);
  });

  it('stays quiet for the routine daily plan', () => {
    expect(new AlertFeed().ingest([replanned(19_800, 'daily', [0, 1, 2])])).toEqual([]);
  });

  it('warns when must-serve streets were deferred (fairness), with how many', () => {
    const raised = new AlertFeed().ingest([replanned(19_800, 'daily', [0], 3)]);
    expect(raised.map((a) => [a.kind, a.severity, a.target, a.detail])).toEqual([['fairness', 'warning', { type: 'system', id: 0 }, '3']]);
  });

  it('warns when a plan fails, with the reason', () => {
    const raised = new AlertFeed().ingest([{ t: 19_800, kind: 'PlanFailed', cause: 'daily', reason: 'solver timed out' }]);
    expect(raised.map((a) => [a.kind, a.severity, a.target, a.detail])).toEqual([['plan-failed', 'warning', { type: 'system', id: 0 }, 'solver timed out']]);
  });
});
