import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '../../../../src/sim/agents/fsm';
import { activationChance, blackSpotNext } from '../../../../src/sim/agents/black-spot';
import { crewNext } from '../../../../src/sim/agents/crew';

// Requirements L-2 and architecture §4: black spots and the clearance crews that clear them.

describe('blackSpotNext', () => {
  it('activates, grows, gets a crew and is cleared', () => {
    let s = blackSpotNext({ kind: 'Dormant' }, { kind: 'Activate', initialKg: 40 });
    expect(s).toEqual({ kind: 'Active', sizeKg: 40 });
    s = blackSpotNext(s, { kind: 'Grow', kg: 15 });
    expect(s).toEqual({ kind: 'Active', sizeKg: 55 });
    s = blackSpotNext(s, { kind: 'CrewArrived' });
    expect(s).toEqual({ kind: 'Clearing', sizeKg: 55 });
    expect(blackSpotNext(s, { kind: 'Cleared' })).toEqual({ kind: 'Dormant' });
  });

  it('rejects negative growth', () => {
    expect(() => blackSpotNext({ kind: 'Active', sizeKg: 5 }, { kind: 'Grow', kg: -1 })).toThrow(RangeError);
  });

  it('rejects inputs that make no sense in the state', () => {
    expect(() => blackSpotNext({ kind: 'Dormant' }, { kind: 'Grow', kg: 1 })).toThrow(IllegalTransitionError);
    expect(() => blackSpotNext({ kind: 'Dormant' }, { kind: 'CrewArrived' })).toThrow(IllegalTransitionError);
    expect(() => blackSpotNext({ kind: 'Active', sizeKg: 1 }, { kind: 'Activate', initialKg: 1 })).toThrow(IllegalTransitionError);
    expect(() => blackSpotNext({ kind: 'Active', sizeKg: 1 }, { kind: 'Cleared' })).toThrow(IllegalTransitionError);
  });
});

describe('activationChance', () => {
  const pressure = fc.record({
    backlogHours: fc.double({ min: 0, max: 240, noNaN: true }),
    skipsLast24h: fc.integer({ min: 0, max: 50 }),
    baseChancePerHour: fc.double({ min: 0, max: 0.05, noNaN: true }),
  });

  it('equals the base chance with no backlog and no skips', () => {
    expect(activationChance({ backlogHours: 0, skipsLast24h: 0, baseChancePerHour: 0.002 })).toBeCloseTo(0.002, 12);
  });

  it('stays in [0, 1)', () => {
    fc.assert(
      fc.property(pressure, (p) => {
        const c = activationChance(p);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(1);
      }),
    );
  });

  it('never decreases as backlog or skips grow', () => {
    fc.assert(
      fc.property(pressure, fc.double({ min: 0, max: 100, noNaN: true }), fc.integer({ min: 0, max: 10 }), (p, moreHours, moreSkips) => {
        expect(activationChance({ ...p, backlogHours: p.backlogHours + moreHours })).toBeGreaterThanOrEqual(activationChance(p));
        expect(activationChance({ ...p, skipsLast24h: p.skipsLast24h + moreSkips })).toBeGreaterThanOrEqual(activationChance(p));
      }),
    );
  });

  it('rises clearly once a street has gone unserved for two days with skips', () => {
    const calm = activationChance({ backlogHours: 0, skipsLast24h: 0, baseChancePerHour: 0.002 });
    const neglected = activationChance({ backlogHours: 48, skipsLast24h: 3, baseChancePerHour: 0.002 });
    expect(neglected).toBeGreaterThan(5 * calm);
  });
});

describe('crewNext', () => {
  it('runs dispatch → travel → clearing → disposal → idle', () => {
    let s = crewNext({ kind: 'Idle' }, { kind: 'Dispatch', blackSpotId: 4 });
    expect(s).toEqual({ kind: 'ToBlackSpot', blackSpotId: 4 });
    s = crewNext(s, { kind: 'Arrived' });
    expect(s).toEqual({ kind: 'Clearing', blackSpotId: 4 });
    s = crewNext(s, { kind: 'ClearingDone' });
    expect(s).toEqual({ kind: 'ToDisposal' });
    expect(crewNext(s, { kind: 'Unloaded' })).toEqual({ kind: 'Idle' });
  });

  it('rejects a second dispatch while busy', () => {
    expect(() => crewNext({ kind: 'ToBlackSpot', blackSpotId: 1 }, { kind: 'Dispatch', blackSpotId: 2 })).toThrow(IllegalTransitionError);
    expect(() => crewNext({ kind: 'Idle' }, { kind: 'Arrived' })).toThrow(IllegalTransitionError);
  });
});
