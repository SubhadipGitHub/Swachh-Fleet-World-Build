import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '../../../../src/sim/agents/fsm';
import { compactorNext, type CompactorInput, type CompactorState } from '../../../../src/sim/agents/compactor';

// Architecture §4: compactor state machine, including diversion to the landfill when KCDC is at its cap (L-1 step 6).

const LEGAL: readonly [string, CompactorState, CompactorInput, CompactorState][] = [
  ['shift starts', { kind: 'OffShift' }, { kind: 'ShiftStart' }, { kind: 'ToTransferPoint' }],
  ['arrives at a transfer point', { kind: 'ToTransferPoint' }, { kind: 'ArrivedAtTransferPoint' }, { kind: 'Queued' }],
  ['bay frees up', { kind: 'Queued' }, { kind: 'BayFree' }, { kind: 'Loading' }],
  ['departs loaded', { kind: 'Loading' }, { kind: 'Depart' }, { kind: 'ToKCDC' }],
  ['reaches KCDC', { kind: 'ToKCDC' }, { kind: 'ArrivedAtKCDC' }, { kind: 'Weighing' }],
  ['weighed and accepted', { kind: 'Weighing' }, { kind: 'Weighed', diverted: false }, { kind: 'Unloading', site: 'KCDC' }],
  ['weighed and diverted', { kind: 'Weighing' }, { kind: 'Weighed', diverted: true }, { kind: 'ToLandfill' }],
  ['reaches the landfill', { kind: 'ToLandfill' }, { kind: 'ArrivedAtLandfill' }, { kind: 'Unloading', site: 'Landfill' }],
  ['unloaded, more runs', { kind: 'Unloading', site: 'KCDC' }, { kind: 'UnloadDone', moreRuns: true }, { kind: 'ToTransferPoint' }],
  ['unloaded, done', { kind: 'Unloading', site: 'Landfill' }, { kind: 'UnloadDone', moreRuns: false }, { kind: 'ToDepot' }],
  ['home', { kind: 'ToDepot' }, { kind: 'ArrivedAtDepot' }, { kind: 'OffShift' }],
  ['breaks down hauling', { kind: 'ToKCDC' }, { kind: 'Breakdown' }, { kind: 'BrokenDown', resume: { kind: 'ToKCDC' } }],
  ['repaired', { kind: 'BrokenDown', resume: { kind: 'ToLandfill' } }, { kind: 'Repaired' }, { kind: 'ToLandfill' }],
];

const ILLEGAL: readonly [CompactorState, CompactorInput][] = [
  [{ kind: 'OffShift' }, { kind: 'Depart' }],
  [{ kind: 'Queued' }, { kind: 'Depart' }],
  [{ kind: 'Loading' }, { kind: 'Breakdown' }],
  [{ kind: 'Weighing' }, { kind: 'ArrivedAtLandfill' }],
  [{ kind: 'ToKCDC' }, { kind: 'Weighed', diverted: false }],
  [{ kind: 'Unloading', site: 'KCDC' }, { kind: 'ArrivedAtDepot' }],
];

describe('compactorNext', () => {
  it.each(LEGAL)('%s', (_name, state, input, expected) => {
    expect(compactorNext(state, input)).toEqual(expected);
  });

  it.each(ILLEGAL.map(([s, i]) => [`${i.kind} in ${s.kind}`, s, i] as const))('rejects %s', (_name, state, input) => {
    expect(() => compactorNext(state, input)).toThrow(IllegalTransitionError);
  });
});
