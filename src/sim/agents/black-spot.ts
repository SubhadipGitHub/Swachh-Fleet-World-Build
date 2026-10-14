import { IllegalTransitionError } from './fsm';

export type BlackSpotState =
  | { readonly kind: 'Dormant' }
  | { readonly kind: 'Active'; readonly sizeKg: number }
  | { readonly kind: 'Clearing'; readonly sizeKg: number };

export type BlackSpotInput =
  | { readonly kind: 'Activate'; readonly initialKg: number }
  | { readonly kind: 'Grow'; readonly kg: number }
  /** M3-D2: part of the dumped waste leaves the system (informal collection, burning). */
  | { readonly kind: 'Leak'; readonly kg: number }
  | { readonly kind: 'CrewArrived' }
  | { readonly kind: 'Cleared' };

/**
 * Black-spot transitions (L-2, architecture §4):
 * - Dormant + Activate → Active with initialKg
 * - Active + Grow → Active with sizeKg + kg (kg must be ≥ 0, else RangeError)
 * - Active + Leak → Active with sizeKg − kg (0 ≤ kg ≤ sizeKg, else RangeError)
 * - Active + CrewArrived → Clearing with the same size
 * - Clearing + Cleared → Dormant
 * - anything else throws IllegalTransitionError
 */
export function blackSpotNext(state: BlackSpotState, input: BlackSpotInput): BlackSpotState {
  const illegal = (): never => {
    throw new IllegalTransitionError('black spot', state.kind, input.kind);
  };
  switch (input.kind) {
    case 'Activate':
      return state.kind === 'Dormant' ? { kind: 'Active', sizeKg: input.initialKg } : illegal();
    case 'Grow':
      if (state.kind !== 'Active') return illegal();
      if (!(input.kg >= 0)) throw new RangeError(`Black spot growth must be ≥ 0, got ${input.kg}`);
      return { kind: 'Active', sizeKg: state.sizeKg + input.kg };
    case 'Leak':
      if (state.kind !== 'Active') return illegal();
      if (!(input.kg >= 0 && input.kg <= state.sizeKg)) throw new RangeError(`Black spot leak must be within 0–${state.sizeKg}, got ${input.kg}`);
      return { kind: 'Active', sizeKg: state.sizeKg - input.kg };
    case 'CrewArrived':
      return state.kind === 'Active' ? { kind: 'Clearing', sizeKg: state.sizeKg } : illegal();
    case 'Cleared':
      return state.kind === 'Clearing' ? { kind: 'Dormant' } : illegal();
  }
}

export interface ActivationInput {
  /** Hours since the nearby segments were last served (the largest among them). */
  readonly backlogHours: number;
  /** Stops skipped on the spot's segments in the last 24 h. */
  readonly skipsLast24h: number;
  /** Chance per hourly check with no backlog and no skips. */
  readonly baseChancePerHour: number;
}

/** Pressure per hour of backlog and per recent skip (`assumed`: about 2.4% an hour after two days' neglect and 3 skips). */
const PER_BACKLOG_HOUR = 0.0002;
const PER_SKIP = 0.004;

/** Chance per hourly check that a dormant spot activates: baseChancePerHour at zero pressure, non-decreasing in both pressures, always in [0, 1). */
export function activationChance(input: ActivationInput): number {
  const pressure = PER_BACKLOG_HOUR * Math.max(0, input.backlogHours) + PER_SKIP * Math.max(0, input.skipsLast24h);
  const p = 1 - (1 - input.baseChancePerHour) * Math.exp(-pressure);
  return Math.min(Math.max(p, 0), 1 - 1e-12);
}
