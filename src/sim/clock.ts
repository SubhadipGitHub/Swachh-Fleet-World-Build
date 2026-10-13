import { notImplemented } from '../shared/not-implemented';
import type { IsoDate } from '../config/sources';

/** Integer seconds since 00:00 IST on the scenario's start date (AD-5). */
export type SimTime = number;

export const DAY_SEC = 86_400;
/** IST is UTC+05:30 all year (no daylight saving). */
export const IST_OFFSET_SEC = 19_800;

export function secondOfDay(t: SimTime): number {
  return notImplemented('secondOfDay', t);
}

/** 0 on the start date, 1 the next day, and so on. */
export function dayIndex(t: SimTime): number {
  return notImplemented('dayIndex', t);
}

/** The IST calendar date at sim time t. */
export function istDate(t: SimTime, start: IsoDate): IsoDate {
  return notImplemented('istDate', t, start);
}

/** "YYYY-MM-DD HH:MM" in IST. */
export function formatIst(t: SimTime, start: IsoDate): string {
  return notImplemented('formatIst', t, start);
}

/** Milliseconds since the Unix epoch (UTC) at sim time t. */
export function toUtcMs(t: SimTime, start: IsoDate): number {
  return notImplemented('toUtcMs', t, start);
}

/** Sim time of hh:mm IST on the given day index. Throws RangeError for hh ∉ 0..23 or mm ∉ 0..59. */
export function at(day: number, hh: number, mm: number): SimTime {
  return notImplemented('at', day, hh, mm);
}

/** Throws RangeError unless the text is a real calendar date in YYYY-MM-DD form. */
export function parseIsoDate(text: string): IsoDate {
  return notImplemented('parseIsoDate', text);
}
