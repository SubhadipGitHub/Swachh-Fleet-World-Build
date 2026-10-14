import { IllegalTransitionError } from './fsm';

export type CompactorResumable =
  | { readonly kind: 'ToTransferPoint' }
  | { readonly kind: 'ToKCDC' }
  | { readonly kind: 'ToLandfill' }
  | { readonly kind: 'ToDepot' };

export type CompactorState =
  | { readonly kind: 'OffShift' }
  | CompactorResumable
  /** M3-D7: on shift, parked, waiting for the Dynamic dispatcher. */
  | { readonly kind: 'Waiting' }
  | { readonly kind: 'Queued' }
  | { readonly kind: 'Loading' }
  | { readonly kind: 'Weighing' }
  | { readonly kind: 'Unloading'; readonly site: 'KCDC' | 'Landfill' }
  | { readonly kind: 'BrokenDown'; readonly resume: CompactorResumable };

export type CompactorInput =
  | { readonly kind: 'ShiftStart'; readonly wait?: boolean }
  | { readonly kind: 'ArrivedAtTransferPoint' }
  | { readonly kind: 'BayFree' }
  | { readonly kind: 'Depart' }
  | { readonly kind: 'ArrivedAtKCDC' }
  | { readonly kind: 'Weighed'; readonly diverted: boolean }
  | { readonly kind: 'ArrivedAtLandfill' }
  | { readonly kind: 'UnloadDone'; readonly moreRuns: boolean; readonly wait?: boolean }
  | { readonly kind: 'Dispatch' }
  | { readonly kind: 'GoHome' }
  | { readonly kind: 'ArrivedAtDepot' }
  | { readonly kind: 'Breakdown' }
  | { readonly kind: 'Repaired' };

/**
 * Compactor transitions (architecture §4):
 * - OffShift + ShiftStart → ToTransferPoint, or Waiting under Dynamic dispatch (wait)
 * - ToTransferPoint + ArrivedAtTransferPoint → Queued; Queued + BayFree → Loading; Loading + Depart → ToKCDC
 * - ToKCDC + ArrivedAtKCDC → Weighing
 * - Weighing + Weighed → Unloading at KCDC, or ToLandfill if diverted (KCDC at its intake cap)
 * - ToLandfill + ArrivedAtLandfill → Unloading at Landfill
 * - Unloading + UnloadDone → ToTransferPoint if moreRuns (Waiting if wait), else ToDepot
 * - Waiting + Dispatch → ToTransferPoint; Waiting + GoHome → ToDepot (M3-D7)
 * - ToDepot + ArrivedAtDepot → OffShift
 * - ToTransferPoint, ToKCDC, ToLandfill, ToDepot + Breakdown → BrokenDown; + Repaired → the resume state
 * - anything else throws IllegalTransitionError
 */
export function compactorNext(state: CompactorState, input: CompactorInput): CompactorState {
  const illegal = (): never => {
    throw new IllegalTransitionError('compactor', state.kind, input.kind);
  };
  switch (input.kind) {
    case 'ShiftStart':
      return state.kind === 'OffShift' ? (input.wait ? { kind: 'Waiting' } : { kind: 'ToTransferPoint' }) : illegal();
    case 'ArrivedAtTransferPoint':
      return state.kind === 'ToTransferPoint' ? { kind: 'Queued' } : illegal();
    case 'BayFree':
      return state.kind === 'Queued' ? { kind: 'Loading' } : illegal();
    case 'Depart':
      return state.kind === 'Loading' ? { kind: 'ToKCDC' } : illegal();
    case 'ArrivedAtKCDC':
      return state.kind === 'ToKCDC' ? { kind: 'Weighing' } : illegal();
    case 'Weighed':
      return state.kind === 'Weighing' ? (input.diverted ? { kind: 'ToLandfill' } : { kind: 'Unloading', site: 'KCDC' }) : illegal();
    case 'ArrivedAtLandfill':
      return state.kind === 'ToLandfill' ? { kind: 'Unloading', site: 'Landfill' } : illegal();
    case 'UnloadDone':
      return state.kind === 'Unloading' ? (input.moreRuns ? (input.wait ? { kind: 'Waiting' } : { kind: 'ToTransferPoint' }) : { kind: 'ToDepot' }) : illegal();
    case 'Dispatch':
      return state.kind === 'Waiting' ? { kind: 'ToTransferPoint' } : illegal();
    case 'GoHome':
      return state.kind === 'Waiting' ? { kind: 'ToDepot' } : illegal();
    case 'ArrivedAtDepot':
      return state.kind === 'ToDepot' ? { kind: 'OffShift' } : illegal();
    case 'Breakdown':
      return state.kind === 'ToTransferPoint' || state.kind === 'ToKCDC' || state.kind === 'ToLandfill' || state.kind === 'ToDepot'
        ? { kind: 'BrokenDown', resume: { kind: state.kind } }
        : illegal();
    case 'Repaired':
      return state.kind === 'BrokenDown' ? state.resume : illegal();
  }
}
