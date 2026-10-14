import { DAY_SEC, type SimTime } from './clock';

/** A knot of a daily generation profile: relative weight at a second of the day. */
export interface ProfileKnot {
  readonly sec: number;
  readonly w: number;
}

/**
 * Piecewise-linear, periodic over one day, and normalised so its integral over a day is 1: profileRate gives the
 * fraction of a day's waste generated per second (AD-5, lazy generation).
 */
export type DailyProfile = readonly ProfileKnot[];

/** Area under the (unnormalised) profile over each knot interval, with the wrap back to midnight last. */
function segmentAreas(knots: readonly ProfileKnot[]): number[] {
  return knots.map((k, i) => {
    const next = knots[i + 1] ?? { sec: DAY_SEC, w: knots[0]!.w };
    return ((k.w + next.w) / 2) * (next.sec - k.sec);
  });
}

/**
 * Validates and normalises knots. Throws RangeError unless the first knot is at 0, knots strictly increase and stay
 * below 86,400, weights are ≥ 0, and at least one weight is > 0.
 */
export function normaliseProfile(knots: readonly ProfileKnot[]): DailyProfile {
  if (knots.length === 0) throw new RangeError('A profile needs at least one knot');
  if (knots[0]!.sec !== 0) throw new RangeError('The first knot must be at second 0');
  knots.forEach((k, i) => {
    if (!(k.w >= 0) || !Number.isFinite(k.w)) throw new RangeError(`Knot ${i} has an invalid weight`);
    if (k.sec >= DAY_SEC) throw new RangeError(`Knot ${i} is not within the day`);
    if (i > 0 && k.sec <= knots[i - 1]!.sec) throw new RangeError('Knots must strictly increase');
  });
  const total = segmentAreas(knots).reduce((s, a) => s + a, 0);
  if (!(total > 0)) throw new RangeError('A profile needs at least one positive weight');
  return knots.map((k) => ({ sec: k.sec, w: k.w / total }));
}

/** Fraction of the daily total generated per second at a given second of the day. */
export function profileRate(profile: DailyProfile, secondOfDay: number): number {
  const s = ((secondOfDay % DAY_SEC) + DAY_SEC) % DAY_SEC;
  let i = profile.length - 1;
  while (i > 0 && profile[i]!.sec > s) i--;
  const k = profile[i]!;
  const next = profile[i + 1] ?? { sec: DAY_SEC, w: profile[0]!.w };
  return k.w + ((next.w - k.w) * (s - k.sec)) / (next.sec - k.sec);
}

/** Integral of the profile from 0 to s (0 ≤ s ≤ DAY_SEC), in days' worth (0..1). */
function cumulativeWithinDay(profile: DailyProfile, s: number): number {
  let acc = 0;
  for (let i = 0; i < profile.length; i++) {
    const k = profile[i]!;
    const next = profile[i + 1] ?? { sec: DAY_SEC, w: profile[0]!.w };
    if (s >= next.sec) {
      acc += ((k.w + next.w) / 2) * (next.sec - k.sec);
      continue;
    }
    if (s > k.sec) {
      const ws = k.w + ((next.w - k.w) * (s - k.sec)) / (next.sec - k.sec);
      acc += ((k.w + ws) / 2) * (s - k.sec);
    }
    break;
  }
  return acc;
}

/** Integral of the profile from 0 to t over any number of days (full days contribute exactly 1 each). */
function cumulative(profile: DailyProfile, t: number): number {
  const days = Math.floor(t / DAY_SEC);
  return days + cumulativeWithinDay(profile, t - days * DAY_SEC);
}

/** A multiplier over [from, to) (weather, festival). Spans must not overlap; time outside every span has factor 1. */
export interface MultiplierSpan {
  readonly from: SimTime;
  readonly to: SimTime;
  readonly factor: number;
}

/**
 * Waste generated over [from, to), in closed form: dailyKg × ∫ profile × multipliers. Equal to step-wise integration.
 * Throws RangeError if to < from or spans overlap.
 */
export function accumulatedKg(dailyKg: number, profile: DailyProfile, from: SimTime, to: SimTime, spans?: readonly MultiplierSpan[]): number {
  if (to < from) throw new RangeError(`Interval ends before it starts: [${from}, ${to})`);
  if (to === from) return 0;
  const base = (a: number, b: number): number => cumulative(profile, b) - cumulative(profile, a);
  if (!spans || spans.length === 0) return dailyKg * base(from, to);

  const sorted = [...spans].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.from < sorted[i - 1]!.to) throw new RangeError('Multiplier spans overlap');
  }
  let total = base(from, to);
  for (const span of sorted) {
    const a = Math.max(from, span.from);
    const b = Math.min(to, span.to);
    if (b > a) total += (span.factor - 1) * base(a, b);
  }
  return dailyKg * total;
}

let profilesCache: { readonly household: DailyProfile; readonly market: DailyProfile } | null = null;

/**
 * The default profiles (`assumed`): households peak in the morning (06:00–10:00); markets peak after market hours
 * (17:00–23:00).
 */
export function defaultProfiles(): { readonly household: DailyProfile; readonly market: DailyProfile } {
  profilesCache ??= {
    household: normaliseProfile([
      { sec: 0, w: 0.15 },
      { sec: 5 * 3600, w: 0.3 },
      { sec: 7.5 * 3600, w: 2.2 },
      { sec: 10 * 3600, w: 1.2 },
      { sec: 13 * 3600, w: 0.9 },
      { sec: 17 * 3600, w: 0.8 },
      { sec: 20.5 * 3600, w: 1.3 },
      { sec: 23 * 3600, w: 0.4 },
    ]),
    market: normaliseProfile([
      { sec: 0, w: 0.2 },
      { sec: 6 * 3600, w: 0.3 },
      { sec: 10 * 3600, w: 0.9 },
      { sec: 14 * 3600, w: 1.0 },
      { sec: 17 * 3600, w: 1.4 },
      { sec: 20 * 3600, w: 2.4 },
      { sec: 22.5 * 3600, w: 1.0 },
    ]),
  };
  return profilesCache;
}
