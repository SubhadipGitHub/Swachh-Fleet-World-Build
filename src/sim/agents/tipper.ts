import { IllegalTransitionError } from './fsm';

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
  const illegal = (): never => {
    throw new IllegalTransitionError('auto-tipper', state.kind, input.kind);
  };
  const resumable = (): TipperResumable => {
    switch (state.kind) {
      case 'ToBeat':
      case 'Driving':
      case 'ToTransfer':
      case 'ToDepot':
        return { kind: state.kind };
      case 'Serving':
        return { kind: 'Driving' };
      default:
        return illegal();
    }
  };

  switch (input.kind) {
    case 'ShiftStart':
      return state.kind === 'OffShift' ? (input.absent ? { kind: 'Absent' } : { kind: 'ToBeat' }) : illegal();
    case 'ArrivedAtBeat':
      return state.kind === 'ToBeat' ? { kind: 'Driving' } : illegal();
    case 'ReachedSegment':
      return state.kind === 'Driving' ? { kind: 'Serving', segmentId: input.segmentId } : illegal();
    case 'SegmentDone':
      return state.kind === 'Serving' ? { kind: 'Driving' } : illegal();
    case 'PayloadFull':
      return state.kind === 'Driving' || state.kind === 'Serving' ? { kind: 'ToTransfer' } : illegal();
    case 'BeatDone':
      return state.kind === 'Driving' ? { kind: 'ToTransfer' } : illegal();
    case 'ArrivedAtTransfer':
      return state.kind === 'ToTransfer' ? { kind: 'Tipping' } : illegal();
    case 'TipDone':
      return state.kind === 'Tipping' ? (input.beatRemaining ? { kind: 'ToBeat' } : { kind: 'ToDepot' }) : illegal();
    case 'ArrivedAtDepot':
      return state.kind === 'ToDepot' ? { kind: 'OffShift' } : illegal();
    case 'Breakdown':
      return { kind: 'BrokenDown', resume: resumable() };
    case 'Repaired':
      return state.kind === 'BrokenDown' ? state.resume : illegal();
    case 'Deviate':
      return state.kind === 'ToBeat' || state.kind === 'Driving' ? { kind: 'Deviating', resume: { kind: state.kind } } : illegal();
    case 'Rejoin':
      return state.kind === 'Deviating' ? state.resume : illegal();
    case 'ShiftEnd':
      switch (state.kind) {
        case 'Absent':
        case 'BrokenDown':
          return { kind: 'OffShift' };
        case 'ToBeat':
        case 'Driving':
        case 'Serving':
        case 'Deviating':
          return input.loadKg > 0 ? { kind: 'ToTransfer' } : { kind: 'ToDepot' };
        case 'ToTransfer':
        case 'Tipping':
        case 'ToDepot':
          return state;
        default:
          return illegal();
      }
  }
}
