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

const TWO_32 = 4_294_967_296;

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

class Xoshiro128ss implements Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: RngState) {
    [this.s0, this.s1, this.s2, this.s3] = state.map((w) => w >>> 0) as [number, number, number, number];
  }

  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  next(): number {
    return this.nextU32() / TWO_32;
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError(`Bad integer range [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    if (p <= 0) {
      this.nextU32();
      return false;
    }
    if (p >= 1) {
      this.nextU32();
      return true;
    }
    return this.next() < p;
  }

  normal(mean = 0, sd = 1): number {
    const u1 = 1 - this.next();
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  state(): readonly [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }
}

/** Starts from an exact state. Throws RangeError for the all-zero state. */
export function rngFromState(state: RngState): Rng {
  if (state.every((w) => w >>> 0 === 0)) throw new RangeError('xoshiro128** state must not be all zero');
  return new Xoshiro128ss(state);
}

/** splitmix32 step: returns [output, next state]. */
function splitmix32(a: number): [number, number] {
  const next = (a + 0x9e3779b9) >>> 0;
  let t = next ^ (next >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return [t >>> 0, next];
}

/** Starts from a 32-bit seed, expanded to a non-zero state with splitmix32. */
export function rngFromSeed(seed: number): Rng {
  let a = seed >>> 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [out, next] = splitmix32(a);
    words.push(out);
    a = next;
  }
  if (!words.some((w) => w !== 0)) words[0] = 1;
  return new Xoshiro128ss(words as unknown as RngState);
}

/** Named streams (AD-5): each system draws only from its own, so adding draws elsewhere never shifts its numbers. */
export const STREAM_NAMES = ['generation', 'sensors', 'absence', 'breakdown', 'compliance', 'blackspots', 'weather', 'traffic', 'layout'] as const;
export type StreamName = (typeof STREAM_NAMES)[number];

/** 32-bit FNV-1a of a string's UTF-16 code units, mixed with a seed. */
function hashName(seed: number, name: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return splitmix32(h)[0];
}

/** One generator per stream, each seeded from a hash of (runSeed, stream name). */
export function createStreams(runSeed: number): Readonly<Record<StreamName, Rng>> {
  const out = {} as Record<StreamName, Rng>;
  for (const name of STREAM_NAMES) out[name] = rngFromSeed(hashName(runSeed >>> 0, name));
  return out;
}
