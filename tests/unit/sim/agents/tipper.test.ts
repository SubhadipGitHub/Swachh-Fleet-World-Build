import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '../../../../src/sim/agents/fsm';
import { tipperNext, type TipperInput, type TipperState } from '../../../../src/sim/agents/tipper';

// Architecture §4: auto-tipper state machine.

const S = {
  OffShift: { kind: 'OffShift' },
  Absent: { kind: 'Absent' },
  ToBeat: { kind: 'ToBeat' },
  Driving: { kind: 'Driving' },
  Serving: { kind: 'Serving', segmentId: 7 },
  ToTransfer: { kind: 'ToTransfer' },
  Tipping: { kind: 'Tipping' },
  ToDepot: { kind: 'ToDepot' },
} as const satisfies Record<string, TipperState>;

const LEGAL: readonly [string, TipperState, TipperInput, TipperState][] = [
  ['shift starts', S.OffShift, { kind: 'ShiftStart', absent: false }, S.ToBeat],
  ['driver absent', S.OffShift, { kind: 'ShiftStart', absent: true }, S.Absent],
  ['reaches beat', S.ToBeat, { kind: 'ArrivedAtBeat' }, S.Driving],
  ['reaches a segment', S.Driving, { kind: 'ReachedSegment', segmentId: 7 }, S.Serving],
  ['segment done', S.Serving, { kind: 'SegmentDone' }, S.Driving],
  ['full while driving', S.Driving, { kind: 'PayloadFull' }, S.ToTransfer],
  ['full while serving', S.Serving, { kind: 'PayloadFull' }, S.ToTransfer],
  ['beat done', S.Driving, { kind: 'BeatDone' }, S.ToTransfer],
  ['at transfer point', S.ToTransfer, { kind: 'ArrivedAtTransfer' }, S.Tipping],
  ['tipped, beat remains', S.Tipping, { kind: 'TipDone', beatRemaining: true }, S.ToBeat],
  ['tipped, beat finished', S.Tipping, { kind: 'TipDone', beatRemaining: false }, S.ToDepot],
  ['home', S.ToDepot, { kind: 'ArrivedAtDepot' }, S.OffShift],
  ['breaks down driving', S.Driving, { kind: 'Breakdown' }, { kind: 'BrokenDown', resume: S.Driving }],
  ['breaks down serving (resumes driving)', S.Serving, { kind: 'Breakdown' }, { kind: 'BrokenDown', resume: S.Driving }],
  ['breaks down going home', S.ToDepot, { kind: 'Breakdown' }, { kind: 'BrokenDown', resume: S.ToDepot }],
  ['repaired', { kind: 'BrokenDown', resume: S.ToTransfer }, { kind: 'Repaired' }, S.ToTransfer],
  ['deviates', S.Driving, { kind: 'Deviate' }, { kind: 'Deviating', resume: S.Driving }],
  ['deviates on the way out', S.ToBeat, { kind: 'Deviate' }, { kind: 'Deviating', resume: S.ToBeat }],
  ['rejoins', { kind: 'Deviating', resume: S.Driving }, { kind: 'Rejoin' }, S.Driving],
  ['shift ends while absent', S.Absent, { kind: 'ShiftEnd', loadKg: 0 }, S.OffShift],
  ['shift ends while broken down (towed)', { kind: 'BrokenDown', resume: S.Driving }, { kind: 'ShiftEnd', loadKg: 300 }, S.OffShift],
  ['shift ends loaded', S.Driving, { kind: 'ShiftEnd', loadKg: 120 }, S.ToTransfer],
  ['shift ends empty', S.Serving, { kind: 'ShiftEnd', loadKg: 0 }, S.ToDepot],
  ['shift ends while deviating, loaded', { kind: 'Deviating', resume: S.Driving }, { kind: 'ShiftEnd', loadKg: 50 }, S.ToTransfer],
  ['shift end does not interrupt tipping', S.Tipping, { kind: 'ShiftEnd', loadKg: 400 }, S.Tipping],
  ['shift end does not interrupt the trip home', S.ToDepot, { kind: 'ShiftEnd', loadKg: 0 }, S.ToDepot],
];

const ILLEGAL: readonly [TipperState, TipperInput][] = [
  [S.OffShift, { kind: 'ArrivedAtBeat' }],
  [S.Absent, { kind: 'ShiftStart', absent: false }],
  [S.Driving, { kind: 'ArrivedAtTransfer' }],
  [S.Serving, { kind: 'ReachedSegment', segmentId: 2 }],
  [S.Tipping, { kind: 'Breakdown' }],
  [S.ToTransfer, { kind: 'Deviate' }],
  [S.OffShift, { kind: 'Repaired' }],
  [{ kind: 'BrokenDown', resume: S.Driving }, { kind: 'Rejoin' }],
  [S.ToBeat, { kind: 'TipDone', beatRemaining: true }],
];

describe('tipperNext', () => {
  it.each(LEGAL)('%s', (_name, state, input, expected) => {
    expect(tipperNext(state, input)).toEqual(expected);
  });

  it.each(ILLEGAL.map(([s, i]) => [`${i.kind} in ${s.kind}`, s, i] as const))('rejects %s', (_name, state, input) => {
    expect(() => tipperNext(state, input)).toThrow(IllegalTransitionError);
  });

  it('names the machine, state and input in the error', () => {
    try {
      tipperNext(S.OffShift, { kind: 'ArrivedAtBeat' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalTransitionError);
      expect((e as IllegalTransitionError).stateKind).toBe('OffShift');
      expect((e as IllegalTransitionError).inputKind).toBe('ArrivedAtBeat');
    }
  });

  it('does not mutate its input state', () => {
    const state: TipperState = { kind: 'Deviating', resume: { kind: 'Driving' } };
    const copy = structuredClone(state);
    tipperNext(state, { kind: 'Rejoin' });
    expect(state).toEqual(copy);
  });
});
