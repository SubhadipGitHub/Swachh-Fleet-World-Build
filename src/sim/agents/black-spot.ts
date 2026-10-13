import { notImplemented } from '../../shared/not-implemented';

export type BlackSpotState =
  | { readonly kind: 'Dormant' }
  | { readonly kind: 'Active'; readonly sizeKg: number }
  | { readonly kind: 'Clearing'; readonly sizeKg: number };

export type BlackSpotInput =
  | { readonly kind: 'Activate'; readonly initialKg: number }
  | { readonly kind: 'Grow'; readonly kg: number }
  | { readonly kind: 'CrewArrived' }
  | { readonly kind: 'Cleared' };

/**
 * Black-spot transitions (L-2, architecture §4):
 * - Dormant + Activate → Active with initialKg
 * - Active + Grow → Active with sizeKg + kg (kg must be ≥ 0, else RangeError)
 * - Active + CrewArrived → Clearing with the same size
 * - Clearing + Cleared → Dormant
 * - anything else throws IllegalTransitionError
 */
export function blackSpotNext(state: BlackSpotState, input: BlackSpotInput): BlackSpotState {
  return notImplemented('blackSpotNext', state, input);
}

export interface ActivationInput {
  /** Hours since the nearby segments were last served (the largest among them). */
  readonly backlogHours: number;
  /** Stops skipped on the spot's segments in the last 24 h. */
  readonly skipsLast24h: number;
  /** Chance per hourly check with no backlog and no skips. */
  readonly baseChancePerHour: number;
}

/** Chance per hourly check that a dormant spot activates: baseChancePerHour at zero pressure, non-decreasing in both pressures, always in [0, 1). */
export function activationChance(input: ActivationInput): number {
  return notImplemented('activationChance', input);
}
