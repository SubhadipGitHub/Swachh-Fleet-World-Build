import { notImplemented } from '../shared/not-implemented';
import type { HighwayClass } from '../geo/snapshot';
import type { RoadGraph } from './graph';

/** Travel times are piecewise constant over 15-minute buckets (AD-7). */
export const BUCKET_SEC = 900;
export const BUCKETS_PER_DAY = 96;

/** Morning and evening rush windows (seconds of day) over which the TomTom averages apply (L-4). */
export const MORNING_PEAK: readonly [number, number] = [8 * 3600, 11 * 3600];
export const EVENING_PEAK: readonly [number, number] = [17 * 3600, 20 * 3600];

export interface SpeedCalibration {
  /** Uncongested reference speed the TomTom averages are measured against (km/h). */
  readonly freeFlowRefKmh: number;
  readonly morningPeakKmh: number;
  readonly eveningPeakKmh: number;
}

export interface SpeedModel {
  /** One factor per bucket, in (0, 1]. */
  readonly todFactor: Float64Array;
  readonly classFactor: Readonly<Record<HighwayClass, number>>;
  /** 1 in clear weather, 0.7 in a monsoon downpour (X-1). */
  readonly weatherFactor: number;
}

export function bucketOf(secondOfDay: number): number {
  return notImplemented('bucketOf', secondOfDay);
}

/**
 * Time-of-day factors: 1 from 23:00 to 05:00; the mean factor over each rush window equals that window's average
 * speed ÷ the reference speed (±0.01); adjacent buckets differ by at most 0.15. Class factors default to 1.
 */
export function buildSpeedModel(cal: SpeedCalibration, weatherFactor?: number): SpeedModel {
  return notImplemented('buildSpeedModel', cal, weatherFactor);
}

/**
 * length ÷ (free speed × class factor × time-of-day factor × weather factor), in seconds. Infinity for a closed
 * edge (waterlogging).
 */
export function edgeTimeSec(g: RoadGraph, edge: number, bucket: number, model: SpeedModel, closed?: ReadonlySet<number>): number {
  return notImplemented('edgeTimeSec', g, edge, bucket, model, closed);
}
