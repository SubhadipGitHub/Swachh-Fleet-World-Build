import type { WeatherMode } from '../config/scenario';
import { HIGHWAY_CLASSES, type HighwayClass } from '../geo/snapshot';
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
  if (!(secondOfDay >= 0 && secondOfDay < 86_400)) throw new RangeError(`Second of day out of range: ${secondOfDay}`);
  return Math.floor(secondOfDay / BUCKET_SEC);
}

const b = (h: number): number => (h * 3600) / BUCKET_SEC;

/**
 * Congestion shape g ∈ [0, 1] per bucket: 0 overnight, ramping up from 05:00 to the morning rush (1), easing to
 * 0.75 at midday, back to 1 for the evening rush, ramping down to 0 by 23:00.
 */
function congestionShape(bucket: number): number {
  if (bucket < b(5) || bucket >= b(23)) return 0;
  if (bucket < b(8)) return (bucket - (b(5) - 1)) / (b(8) - b(5) + 1);
  if (bucket < b(11)) return 1;
  if (bucket < b(17)) {
    const intoMidday = Math.min(bucket - b(11) + 1, b(17) - bucket);
    return 1 - 0.25 * Math.min(1, intoMidday / 4);
  }
  if (bucket < b(20)) return 1;
  return (b(23) - bucket) / (b(23) - b(20) + 1);
}

/**
 * Time-of-day factors: 1 from 23:00 to 05:00; the mean factor over each rush window equals that window's average
 * speed ÷ the reference speed (±0.01); adjacent buckets differ by at most 0.15. Class factors default to 1.
 * Because the shape is exactly 1 across both rush windows, factor = 1 − depth there and the means are exact.
 */
export function buildSpeedModel(cal: SpeedCalibration, weatherFactor = 1): SpeedModel {
  const morningDepth = 1 - cal.morningPeakKmh / cal.freeFlowRefKmh;
  const eveningDepth = 1 - cal.eveningPeakKmh / cal.freeFlowRefKmh;
  const todFactor = new Float64Array(BUCKETS_PER_DAY);
  for (let i = 0; i < BUCKETS_PER_DAY; i++) {
    const depth = i < b(14) ? morningDepth : eveningDepth;
    todFactor[i] = 1 - depth * congestionShape(i);
  }
  const classFactor = Object.fromEntries(HIGHWAY_CLASSES.map((c) => [c, 1])) as Record<HighwayClass, number>;
  return { todFactor, classFactor, weatherFactor };
}

/**
 * length ÷ (free speed × class factor × time-of-day factor × weather factor), in seconds. Infinity for a closed
 * edge (waterlogging).
 */
export function edgeTimeSec(g: RoadGraph, edge: number, bucket: number, model: SpeedModel, closed?: ReadonlySet<number>): number {
  if (closed?.has(edge)) return Number.POSITIVE_INFINITY;
  return g.edgeLengthM[edge]! / edgeSpeedMps(g, edge, bucket, model);
}

/** The modelled speed on an edge in a bucket (m/s). */
export function edgeSpeedMps(g: RoadGraph, edge: number, bucket: number, model: SpeedModel): number {
  const cls = HIGHWAY_CLASSES[g.edgeClass[edge]!]!;
  return g.edgeFreeSpeedMps[edge]! * model.classFactor[cls] * model.todFactor[bucket]! * model.weatherFactor;
}

/**
 * The speed model under a weather mode (X-1, M2-4): monsoon multiplies every bucket by 0.7 (weatherFactor); haze
 * multiplies the 05:00–09:00 buckets by 0.9; clear and heatwave leave speeds unchanged. The base model is not changed.
 */
export function applyWeather(base: SpeedModel, mode: WeatherMode): SpeedModel {
  if (mode === 'monsoon') return { ...base, weatherFactor: base.weatherFactor * 0.7 };
  if (mode === 'haze') {
    const todFactor = Float64Array.from(base.todFactor, (f, i) => (i >= b(5) && i < b(9) ? f * 0.9 : f));
    return { ...base, todFactor };
  }
  return base;
}
