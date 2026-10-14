import { IllegalTransitionError } from './fsm';

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
  const illegal = (): never => {
    throw new IllegalTransitionError('clearance crew', state.kind, input.kind);
  };
  switch (input.kind) {
    case 'Dispatch':
      return state.kind === 'Idle' ? { kind: 'ToBlackSpot', blackSpotId: input.blackSpotId } : illegal();
    case 'Arrived':
      return state.kind === 'ToBlackSpot' ? { kind: 'Clearing', blackSpotId: state.blackSpotId } : illegal();
    case 'ClearingDone':
      return state.kind === 'Clearing' ? { kind: 'ToDisposal' } : illegal();
    case 'Unloaded':
      return state.kind === 'ToDisposal' ? { kind: 'Idle' } : illegal();
  }
}
