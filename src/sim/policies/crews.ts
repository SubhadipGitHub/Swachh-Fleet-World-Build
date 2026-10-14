import { getCalibration } from '../../config/calibration';

/** Dynamic clearance crews (architecture M3-D8): black spots by risk, with daytime dispatch for critical ones. */

export interface SpotOutlook {
  readonly id: number;
  /** Size from the spot's sensor (kg). */
  readonly sizeKg: number;
  readonly growthKgPerHour: number;
  /** Estimated backlog on the spot's nearby streets (kg). */
  readonly nearbyBacklogKg: number;
}

export interface CrewWeights {
  readonly size: number;
  readonly growth: number;
  readonly nearby: number;
}

/** Objective weights (`assumed`, M3-11): a kilo on the spot, a kilo an hour of growth, a kilo nearby. */
export const DEFAULT_CREW_WEIGHTS: CrewWeights = { size: 1, growth: 6, nearby: 0.25 };
/** Heatwave risk multiplier (as X-1's black-spot pressure). */
export const HEATWAVE_RISK = 1.5;
/** Critical size: a spot this big may be cleared in daytime under Dynamic (`assumed`). */
export const CRITICAL_SPOT_KG = getCalibration().criticalSpotKg.value;
/** The night clearance window (M2-7), seconds of day. */
export const NIGHT_WINDOW: readonly [number, number] = [19 * 3600, 21 * 3600];

export function spotRisk(spot: SpotOutlook, heatwave: boolean, weights: CrewWeights = DEFAULT_CREW_WEIGHTS): number {
  const r = weights.size * spot.sizeKg + weights.growth * spot.growthKgPerHour + weights.nearby * spot.nearbyBacklogKg;
  return heatwave ? HEATWAVE_RISK * r : r;
}

/** Highest risk first; ties by id. Static ranks by activation order instead (not here). */
export function rankSpots(spots: readonly SpotOutlook[], heatwave: boolean, weights: CrewWeights = DEFAULT_CREW_WEIGHTS): SpotOutlook[] {
  return spots
    .map((s) => ({ s, r: spotRisk(s, heatwave, weights) }))
    .sort((a, b) => b.r - a.r || a.s.id - b.s.id)
    .map((x) => x.s);
}

/** Whether a crew may be sent to a spot of this size now: always inside the night window; outside it, only Dynamic and only at or above the critical size. */
export function mayDispatch(secondOfDay: number, sizeKg: number, policy: 'static' | 'dynamic'): boolean {
  if (secondOfDay >= NIGHT_WINDOW[0] && secondOfDay <= NIGHT_WINDOW[1]) return true;
  return policy === 'dynamic' && sizeKg >= CRITICAL_SPOT_KG;
}
