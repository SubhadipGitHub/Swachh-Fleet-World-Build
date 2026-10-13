import { notImplemented } from '../../shared/not-implemented';

export type CompactorResumable =
  | { readonly kind: 'ToTransferPoint' }
  | { readonly kind: 'ToKCDC' }
  | { readonly kind: 'ToLandfill' }
  | { readonly kind: 'ToDepot' };

export type CompactorState =
  | { readonly kind: 'OffShift' }
  | CompactorResumable
  | { readonly kind: 'Queued' }
  | { readonly kind: 'Loading' }
  | { readonly kind: 'Weighing' }
  | { readonly kind: 'Unloading'; readonly site: 'KCDC' | 'Landfill' }
  | { readonly kind: 'BrokenDown'; readonly resume: CompactorResumable };

export type CompactorInput =
  | { readonly kind: 'ShiftStart' }
  | { readonly kind: 'ArrivedAtTransferPoint' }
  | { readonly kind: 'BayFree' }
  | { readonly kind: 'Depart' }
  | { readonly kind: 'ArrivedAtKCDC' }
  | { readonly kind: 'Weighed'; readonly diverted: boolean }
  | { readonly kind: 'ArrivedAtLandfill' }
  | { readonly kind: 'UnloadDone'; readonly moreRuns: boolean }
  | { readonly kind: 'ArrivedAtDepot' }
  | { readonly kind: 'Breakdown' }
  | { readonly kind: 'Repaired' };

/**
 * Compactor transitions (architecture §4):
 * - OffShift + ShiftStart → ToTransferPoint
 * - ToTransferPoint + ArrivedAtTransferPoint → Queued; Queued + BayFree → Loading; Loading + Depart → ToKCDC
 * - ToKCDC + ArrivedAtKCDC → Weighing
 * - Weighing + Weighed → Unloading at KCDC, or ToLandfill if diverted (KCDC at its intake cap)
 * - ToLandfill + ArrivedAtLandfill → Unloading at Landfill
 * - Unloading + UnloadDone → ToTransferPoint if moreRuns, else ToDepot
 * - ToDepot + ArrivedAtDepot → OffShift
 * - ToTransferPoint, ToKCDC, ToLandfill, ToDepot + Breakdown → BrokenDown; + Repaired → the resume state
 * - anything else throws IllegalTransitionError
 */
export function compactorNext(state: CompactorState, input: CompactorInput): CompactorState {
  return notImplemented('compactorNext', state, input);
}
