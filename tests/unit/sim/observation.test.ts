import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BinObservation, Observation } from '../../../src/sim/observation';

// Architecture AD-5 (truth vs observation): a policy's input type has no path to true fill levels. This is checked
// by the type checker (`npm run typecheck`), so the test body only needs to compile.

describe('Observation type', () => {
  it('exposes sensor readings but no true fill', () => {
    expectTypeOf<BinObservation>().not.toHaveProperty('trueFillPct');
    expectTypeOf<Observation['bins'][number]>().not.toHaveProperty('trueFillPct');
    expectTypeOf<BinObservation['reading']>().not.toHaveProperty('trueFillPct');
    expectTypeOf<BinObservation['reading']['fillPct']>().toEqualTypeOf<number | null>();
  });

  it('cannot read a true fill even through a cast-free access', () => {
    const obs: Observation = { t: 0, bins: [{ binId: 1, readAt: 0, reading: { fillPct: 40, status: 'ok' } }], fleet: [], closedEdges: [] };
    // @ts-expect-error: true fill is not part of what a policy sees.
    const leaked: unknown = obs.bins[0]!.trueFillPct;
    expect(leaked).toBeUndefined();
  });
});
