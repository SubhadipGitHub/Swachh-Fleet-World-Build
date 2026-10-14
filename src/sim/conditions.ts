import type { Rng } from '../shared/rng';

/**
 * Keyed draws for conditions (architecture M3-D1). Every draw that sets a condition (absence, breakdown, early
 * return, a non-compliant skip, a sensor fault, black-spot luck, daily generation variability) is a pure function of
 * `(runSeed, stream, keys…)`, so the live world and the shadow twin face the same conditions whatever order they
 * make their draws in.
 */
export type ConditionStream = 'absence' | 'breakdown' | 'repair' | 'earlyReturn' | 'skip' | 'sensor' | 'blackspots' | 'generation';

const TWO_32 = 4_294_967_296;

/** murmur3's 32-bit finaliser. */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 32-bit FNV-1a of the stream name. */
function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const STREAM_SALT: Readonly<Record<ConditionStream, number>> = {
  absence: nameHash('absence'),
  breakdown: nameHash('breakdown'),
  repair: nameHash('repair'),
  earlyReturn: nameHash('earlyReturn'),
  skip: nameHash('skip'),
  sensor: nameHash('sensor'),
  blackspots: nameHash('blackspots'),
  generation: nameHash('generation'),
};

/** Order-sensitive hash of the seed, stream and keys; `salt` separates the uniforms one draw needs. */
function hash(seed: number, stream: ConditionStream, keys: readonly number[], salt: number): number {
  let h = fmix((seed >>> 0) ^ STREAM_SALT[stream]);
  for (const k of keys) {
    // Keys are integers (ids, days, seconds); split them into two 32-bit halves so large times stay distinct.
    const lo = k >>> 0;
    const hi = Math.floor(k / TWO_32) >>> 0;
    h = fmix((h + Math.imul(lo, 0x9e3779b1)) >>> 0);
    h = fmix((h ^ Math.imul(hi + 0x632be5ab, 0x85ebca77)) >>> 0);
  }
  return fmix((h + Math.imul(salt + 1, 0x27d4eb2f)) >>> 0);
}

/** A uniform draw in [0, 1). */
export function keyedUnit(seed: number, stream: ConditionStream, ...keys: readonly number[]): number {
  return hash(seed, stream, keys, 0) / TWO_32;
}

/** True with probability `p` (p ≤ 0 is never, p ≥ 1 is always). */
export function keyedChance(seed: number, stream: ConditionStream, p: number, ...keys: readonly number[]): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return keyedUnit(seed, stream, ...keys) < p;
}

/** A uniform integer in [lo, hi], inclusive. */
export function keyedInt(seed: number, stream: ConditionStream, lo: number, hi: number, ...keys: readonly number[]): number {
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new RangeError(`Bad integer range [${lo}, ${hi}]`);
  return lo + Math.floor(keyedUnit(seed, stream, ...keys) * (hi - lo + 1));
}

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). Uses only log and
 * sqrt, so simulation decisions stay free of trig (AD-5).
 */
function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lowP = 0.02425;
  if (p < lowP) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lowP) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** A standard normal draw. */
export function keyedNormal(seed: number, stream: ConditionStream, ...keys: readonly number[]): number {
  // Midpoint of the 2³² grid, so p is never exactly 0 or 1.
  return probit((hash(seed, stream, keys, 1) + 0.5) / TWO_32);
}

/** A lognormal multiplier with mean 1 and log-standard-deviation `sigma` (M3-D2 generation variability). */
export function keyedLogNormal(seed: number, stream: ConditionStream, sigma: number, ...keys: readonly number[]): number {
  if (sigma <= 0) return 1;
  return Math.exp(sigma * keyedNormal(seed, stream, ...keys) - (sigma * sigma) / 2);
}

/**
 * An `Rng` whose draws are keyed: the n-th draw is keyed by `(keys…, n)`. For code written against `Rng` (such as
 * `readSensor`) that must draw conditions (M3-D1).
 */
export function keyedRng(seed: number, stream: ConditionStream, ...keys: readonly number[]): Rng {
  let n = 0;
  const unit = (): number => keyedUnit(seed, stream, ...keys, n++);
  return {
    nextU32: () => Math.floor(unit() * TWO_32),
    next: unit,
    int: (min, max) => {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError(`Bad integer range [${min}, ${max}]`);
      return min + Math.floor(unit() * (max - min + 1));
    },
    chance: (p) => (p <= 0 ? false : p >= 1 ? true : unit() < p),
    normal: (mean = 0, sd = 1) => mean + sd * keyedNormal(seed, stream, ...keys, n++),
    state: () => [n, 0, 0, 0],
  };
}
