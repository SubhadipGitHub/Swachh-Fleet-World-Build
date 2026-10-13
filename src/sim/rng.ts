import { notImplemented } from '../shared/not-implemented';

/** xoshiro128** generator (AD-5). All values are derived from 32-bit unsigned outputs. */
export interface Rng {
  /** Next raw output, an integer in [0, 2³²). */
  nextU32(): number;
  /** Uniform in [0, 1), from nextU32() ÷ 2³². */
  next(): number;
  /** Uniform integer in [min, max], both inclusive. Throws RangeError if max < min or either is not an integer. */
  int(min: number, max: number): number;
  /** True with probability p (p ≤ 0 is always false, p ≥ 1 always true). */
  chance(p: number): boolean;
  /** Normal deviate (Box–Muller). */
  normal(mean?: number, sd?: number): number;
  /** Current internal state, for snapshots and tests. */
  state(): readonly [number, number, number, number];
}

export type RngState = readonly [number, number, number, number];

/** Starts from an exact state. Throws RangeError for the all-zero state. */
export function rngFromState(state: RngState): Rng {
  return notImplemented('rngFromState', state);
}

/** Starts from a 32-bit seed, expanded to a non-zero state with splitmix32. */
export function rngFromSeed(seed: number): Rng {
  return notImplemented('rngFromSeed', seed);
}

/** Named streams (AD-5): each system draws only from its own, so adding draws elsewhere never shifts its numbers. */
export const STREAM_NAMES = ['generation', 'sensors', 'absence', 'breakdown', 'compliance', 'blackspots', 'weather', 'traffic', 'layout'] as const;
export type StreamName = (typeof STREAM_NAMES)[number];

/** One generator per stream, each seeded from a hash of (runSeed, stream name). */
export function createStreams(runSeed: number): Readonly<Record<StreamName, Rng>> {
  return notImplemented('createStreams', runSeed);
}
