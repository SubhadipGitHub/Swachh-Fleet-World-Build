import { notImplemented } from '../shared/not-implemented';
import type { SimTime } from './clock';
import type { SensorStatus } from './sensors';

/** The single event stream the tracker, alerts and KPIs are computed from (AD-5). */
export type SimEvent =
  | { readonly t: SimTime; readonly kind: 'ShiftStarted'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'VehicleAbsent'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'StopServed'; readonly vehicleId: number; readonly target: StopTarget; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'StopSkipped'; readonly vehicleId: number; readonly target: StopTarget; readonly reason: SkipReason }
  | { readonly t: SimTime; readonly kind: 'Tipped'; readonly vehicleId: number; readonly transferPointId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'Weighed'; readonly vehicleId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'Diverted'; readonly vehicleId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'Unloaded'; readonly vehicleId: number; readonly site: 'KCDC' | 'Landfill'; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'BrokenDown'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'Repaired'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'RouteDeviation'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'BlackSpotActivated'; readonly blackSpotId: number }
  | { readonly t: SimTime; readonly kind: 'BlackSpotCleared'; readonly blackSpotId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'SensorReading'; readonly binId: number; readonly fillPct: number | null; readonly status: SensorStatus }
  | { readonly t: SimTime; readonly kind: 'ShiftEnded'; readonly vehicleId: number };

export type StopTarget = { readonly type: 'segment'; readonly id: number } | { readonly type: 'bin'; readonly id: number };
export type SkipReason = 'absent' | 'non-compliance' | 'breakdown' | 'shift-ended' | 'road-closed';

export type SimEventKind = SimEvent['kind'];

/** 64-bit FNV-1a over each event's canonical JSON (keys sorted), as 16 lower-case hex digits. Order matters. */
export function hashEvents(events: readonly SimEvent[]): string {
  return notImplemented('hashEvents', events);
}
