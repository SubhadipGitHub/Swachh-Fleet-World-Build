import { notImplemented } from '../shared/not-implemented';
import type { Rng } from './rng';

export type SensorStatus = 'ok' | 'stuck' | 'offline';

export interface SensorParams {
  /** Standard deviation of the reading noise, in fill percentage points. */
  readonly noiseSdPct: number;
  /** Chance per reading that a working sensor fails (half stuck, half offline). */
  readonly faultChancePerReading: number;
  /** Chance per reading that a failed sensor recovers. */
  readonly recoverChancePerReading: number;
}

export interface SensorState {
  readonly status: SensorStatus;
  readonly lastReportedPct: number | null;
}

export interface SensorReading {
  /** Null when offline, or when stuck before any value was reported. */
  readonly fillPct: number | null;
  readonly status: SensorStatus;
}

/**
 * One 15-minute reading (L-1 step 2). The status changes first, then the reading is taken: ok → true fill plus
 * normal noise, clamped to 0–100 and rounded to 0.1; stuck → the last reported value; offline → null.
 */
export function readSensor(trueFillPct: number, state: SensorState, rng: Rng, params: SensorParams): { readonly reading: SensorReading; readonly next: SensorState } {
  return notImplemented('readSensor', trueFillPct, state, rng, params);
}
