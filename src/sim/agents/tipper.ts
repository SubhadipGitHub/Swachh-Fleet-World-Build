import { notImplemented } from '../../shared/not-implemented';

/** States that can be interrupted by a breakdown or a deviation and resumed afterwards. */
export type TipperResumable =
  | { readonly kind: 'ToBeat' }
  | { readonly kind: 'Driving' }
  | { readonly kind: 'ToTransfer' }
  | { readonly kind: 'ToDepot' };

export type TipperState =
  | { readonly kind: 'OffShift' }
  | { readonly kind: 'Absent' }
  | TipperResumable
  | { readonly kind: 'Serving'; readonly segmentId: number }
  | { readonly kind: 'Tipping' }
  | { readonly kind: 'BrokenDown'; readonly resume: TipperResumable }
  | { readonly kind: 'Deviating'; readonly resume: TipperResumable };

export type TipperInput =
  | { readonly kind: 'ShiftStart'; readonly absent: boolean }
  | { readonly kind: 'ArrivedAtBeat' }
  | { readonly kind: 'ReachedSegment'; readonly segmentId: number }
  | { readonly kind: 'SegmentDone' }
  | { readonly kind: 'PayloadFull' }
  | { readonly kind: 'BeatDone' }
  | { readonly kind: 'ArrivedAtTransfer' }
  | { readonly kind: 'TipDone'; readonly beatRemaining: boolean }
  | { readonly kind: 'ArrivedAtDepot' }
  | { readonly kind: 'Breakdown' }
  | { readonly kind: 'Repaired' }
  | { readonly kind: 'Deviate' }
  | { readonly kind: 'Rejoin' }
  | { readonly kind: 'ShiftEnd'; readonly loadKg: number };

/**
 * Auto-tipper transitions (architecture §4):
 * - OffShift + ShiftStart → ToBeat, or Absent if absent
 * - ToBeat + ArrivedAtBeat → Driving
 * - Driving + ReachedSegment → Serving; Serving + SegmentDone → Driving
 * - Driving or Serving + PayloadFull → ToTransfer; Driving + BeatDone → ToTransfer
 * - ToTransfer + ArrivedAtTransfer → Tipping
 * - Tipping + TipDone → ToBeat if beatRemaining, else ToDepot
 * - ToDepot + ArrivedAtDepot → OffShift
 * - ToBeat, Driving, Serving, ToTransfer, ToDepot + Breakdown → BrokenDown (Serving resumes as Driving)
 * - BrokenDown + Repaired → the resume state
 * - ToBeat or Driving + Deviate → Deviating; Deviating + Rejoin → the resume state
 * - ShiftEnd: Absent → OffShift; BrokenDown → OffShift (towed); ToBeat, Driving, Serving, Deviating → ToTransfer if
 *   loadKg > 0, else ToDepot; ToTransfer, Tipping and ToDepot carry on unchanged
 * - anything else throws IllegalTransitionError
 */
export function tipperNext(state: TipperState, input: TipperInput): TipperState {
  return notImplemented('tipperNext', state, input);
}
