import { notImplemented } from '../../shared/not-implemented';

export type CrewState =
  | { readonly kind: 'Idle' }
  | { readonly kind: 'ToBlackSpot'; readonly blackSpotId: number }
  | { readonly kind: 'Clearing'; readonly blackSpotId: number }
  | { readonly kind: 'ToDisposal' };

export type CrewInput =
  | { readonly kind: 'Dispatch'; readonly blackSpotId: number }
  | { readonly kind: 'Arrived' }
  | { readonly kind: 'ClearingDone' }
  | { readonly kind: 'Unloaded' };

/**
 * Clearance crew (tipper lorry plus mini excavator) transitions (architecture §4):
 * - Idle + Dispatch → ToBlackSpot; ToBlackSpot + Arrived → Clearing (same spot)
 * - Clearing + ClearingDone → ToDisposal; ToDisposal + Unloaded → Idle
 * - anything else throws IllegalTransitionError
 */
export function crewNext(state: CrewState, input: CrewInput): CrewState {
  return notImplemented('crewNext', state, input);
}
