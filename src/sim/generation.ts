import { notImplemented } from '../shared/not-implemented';
import type { SimTime } from './clock';

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

/**
 * Validates and normalises knots. Throws RangeError unless the first knot is at 0, knots strictly increase and stay
 * below 86,400, weights are ≥ 0, and at least one weight is > 0.
 */
export function normaliseProfile(knots: readonly ProfileKnot[]): DailyProfile {
  return notImplemented('normaliseProfile', knots);
}

/** Fraction of the daily total generated per second at a given second of the day. */
export function profileRate(profile: DailyProfile, secondOfDay: number): number {
  return notImplemented('profileRate', profile, secondOfDay);
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
  return notImplemented('accumulatedKg', dailyKg, profile, from, to, spans);
}

/**
 * The default profiles (`assumed`): households peak in the morning (06:00–10:00); markets peak after market hours
 * (17:00–23:00).
 */
export function defaultProfiles(): { readonly household: DailyProfile; readonly market: DailyProfile } {
  return notImplemented('defaultProfiles');
}
