import { dayIndex, type SimTime } from './clock';
import type { SimEvent } from './events';

export type AlertKind =
  | 'bin-high'
  | 'bin-overflow'
  | 'black-spot'
  | 'absent'
  | 'breakdown'
  | 'skips'
  | 'deviation'
  | 'kcdc-cap'
  | 'road-closed'
  | 'sensor-offline'
  // M3-D10
  | 'replanned'
  | 'plan-failed'
  | 'fairness';

export type Severity = 'critical' | 'warning' | 'info';

export interface AlertTarget {
  /** `system`: the plan as a whole (M3), with id 0. */
  readonly type: 'bin' | 'vehicle' | 'blackSpot' | 'facility' | 'floodSpot' | 'system';
  readonly id: number;
}

/** One alert (D-8). The UI writes the sentence from the kind and the target's display id. */
export interface Alert {
  /** Increasing from 1 in the order alerts are raised. */
  readonly id: number;
  readonly t: SimTime;
  readonly kind: AlertKind;
  readonly severity: Severity;
  readonly target: AlertTarget;
  /** M3: the re-plan cause, the plan failure reason, or the number of streets at risk. */
  readonly detail?: string;
}

/** Severity of each kind (M2-10). */
export const ALERT_SEVERITY: Readonly<Record<AlertKind, Severity>> = {
  'bin-high': 'warning',
  'bin-overflow': 'critical',
  'black-spot': 'warning',
  absent: 'warning',
  breakdown: 'critical',
  skips: 'info',
  deviation: 'warning',
  'kcdc-cap': 'critical',
  'road-closed': 'warning',
  'sensor-offline': 'info',
  replanned: 'info',
  'plan-failed': 'warning',
  fairness: 'warning',
};

/** The target of plan-wide alerts (M3). */
export const SYSTEM_TARGET: AlertTarget = { type: 'system', id: 0 };

/** The KCDC facility id used as the target of kcdc-cap alerts. */
export const KCDC_TARGET: AlertTarget = { type: 'facility', id: 0 };

const HIGH_PCT = 90;
const OVERFLOW_PCT = 100;
const REARM_PCT = 50;
const SKIPS_FOR_ALERT = 3;

/**
 * Turns the event stream into de-duplicated alerts (M2-10):
 * - bin-high at the first reading ≥ 90%, bin-overflow at the first reading ≥ 100%; both re-arm after a reading < 50%
 * - black-spot on every activation; breakdown on every breakdown; deviation on every route deviation;
 *   road-closed on every closure (target: the flood spot)
 * - absent once per vehicle per day; skips once per vehicle per day, at its 3rd skipped stop
 * - kcdc-cap at the first diversion of each day
 * - sensor-offline at the first offline reading; re-arms after an ok reading
 * - M3: replanned on every incident re-plan (detail: the cause), fairness when a plan defers must-serve streets
 *   (detail: how many), plan-failed on every failed plan (detail: the reason)
 * Keeps at most `max` alerts, dropping the oldest.
 */
export class AlertFeed {
  private nextId = 1;
  private readonly kept: Alert[] = [];
  private readonly binHigh = new Set<number>();
  private readonly binOverflow = new Set<number>();
  private readonly offline = new Set<number>();
  /** "vehicleId:day" keys already alerted. */
  private readonly absentDays = new Set<string>();
  private readonly skipDays = new Set<string>();
  private readonly skipCounts = new Map<string, number>();
  private readonly capDays = new Set<number>();

  constructor(readonly max = 200) {}

  /** Ingests events in time order and returns the alerts they raise, in order. */
  ingest(events: readonly SimEvent[]): Alert[] {
    const raised: Alert[] = [];
    const raise = (t: SimTime, kind: AlertKind, target: AlertTarget, detail?: string): void => {
      const a: Alert = detail === undefined ? { id: this.nextId++, t, kind, severity: ALERT_SEVERITY[kind], target } : { id: this.nextId++, t, kind, severity: ALERT_SEVERITY[kind], target, detail };
      raised.push(a);
      this.kept.push(a);
      if (this.kept.length > this.max) this.kept.splice(0, this.kept.length - this.max);
    };
    for (const e of events) {
      switch (e.kind) {
        case 'SensorReading': {
          const bin = { type: 'bin', id: e.binId } as const;
          if (e.fillPct === null) {
            if (!this.offline.has(e.binId)) {
              this.offline.add(e.binId);
              raise(e.t, 'sensor-offline', bin);
            }
            break;
          }
          if (e.status === 'ok') this.offline.delete(e.binId);
          if (e.fillPct < REARM_PCT) {
            this.binHigh.delete(e.binId);
            this.binOverflow.delete(e.binId);
          }
          if (e.fillPct >= HIGH_PCT && !this.binHigh.has(e.binId)) {
            this.binHigh.add(e.binId);
            raise(e.t, 'bin-high', bin);
          }
          if (e.fillPct >= OVERFLOW_PCT && !this.binOverflow.has(e.binId)) {
            this.binOverflow.add(e.binId);
            raise(e.t, 'bin-overflow', bin);
          }
          break;
        }
        case 'BlackSpotActivated':
          raise(e.t, 'black-spot', { type: 'blackSpot', id: e.blackSpotId });
          break;
        case 'BrokenDown':
          raise(e.t, 'breakdown', { type: 'vehicle', id: e.vehicleId });
          break;
        case 'RouteDeviation':
          raise(e.t, 'deviation', { type: 'vehicle', id: e.vehicleId });
          break;
        case 'RoadClosed':
          raise(e.t, 'road-closed', { type: 'floodSpot', id: e.spotId });
          break;
        case 'VehicleAbsent': {
          const key = `${e.vehicleId}:${dayIndex(e.t)}`;
          if (!this.absentDays.has(key)) {
            this.absentDays.add(key);
            raise(e.t, 'absent', { type: 'vehicle', id: e.vehicleId });
          }
          break;
        }
        case 'StopSkipped': {
          const key = `${e.vehicleId}:${dayIndex(e.t)}`;
          const n = (this.skipCounts.get(key) ?? 0) + 1;
          this.skipCounts.set(key, n);
          if (n >= SKIPS_FOR_ALERT && !this.skipDays.has(key)) {
            this.skipDays.add(key);
            raise(e.t, 'skips', { type: 'vehicle', id: e.vehicleId });
          }
          break;
        }
        case 'Diverted': {
          const day = dayIndex(e.t);
          if (!this.capDays.has(day)) {
            this.capDays.add(day);
            raise(e.t, 'kcdc-cap', KCDC_TARGET);
          }
          break;
        }
        case 'Replanned':
          // M3-D10: incident re-plans name their cause; the routine daily plan is silent unless fairness is at risk.
          if (e.cause !== 'daily' && e.vehicleIds.length > 0) raise(e.t, 'replanned', { type: 'vehicle', id: e.vehicleIds[0]! }, e.cause);
          if (e.deferredMustServe > 0) raise(e.t, 'fairness', SYSTEM_TARGET, String(e.deferredMustServe));
          break;
        case 'PlanFailed':
          raise(e.t, 'plan-failed', SYSTEM_TARGET, e.reason);
          break;
        default:
          break;
      }
    }
    return raised;
  }

  /** All kept alerts, newest first. */
  list(): Alert[] {
    return [...this.kept].reverse();
  }
}
