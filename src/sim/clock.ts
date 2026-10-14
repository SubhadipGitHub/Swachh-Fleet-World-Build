import type { IsoDate } from '../config/sources';
import { civilFromDays, daysFromCivil, formatCivil, parseCivil } from '../shared/civil';

/** Integer seconds since 00:00 IST on the scenario's start date (AD-5). */
export type SimTime = number;

export const DAY_SEC = 86_400;
/** IST is UTC+05:30 all year (no daylight saving). */
export const IST_OFFSET_SEC = 19_800;

export function secondOfDay(t: SimTime): number {
  return ((t % DAY_SEC) + DAY_SEC) % DAY_SEC;
}

/** 0 on the start date, 1 the next day, and so on. */
export function dayIndex(t: SimTime): number {
  return Math.floor(t / DAY_SEC);
}

function startDays(start: IsoDate): number {
  const parts = parseCivil(start);
  if (!parts) throw new RangeError(`Not a date: ${start}`);
  return daysFromCivil(...parts);
}

/** The IST calendar date at sim time t. */
export function istDate(t: SimTime, start: IsoDate): IsoDate {
  return formatCivil(...civilFromDays(startDays(start) + dayIndex(t)));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "YYYY-MM-DD HH:MM" in IST. */
export function formatIst(t: SimTime, start: IsoDate): string {
  const s = secondOfDay(t);
  return `${istDate(t, start)} ${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}`;
}

/** Milliseconds since the Unix epoch (UTC) at sim time t. */
export function toUtcMs(t: SimTime, start: IsoDate): number {
  return (startDays(start) * DAY_SEC + t - IST_OFFSET_SEC) * 1000;
}

/** Sim time of hh:mm IST on the given day index. Throws RangeError for hh ∉ 0..23 or mm ∉ 0..59. */
export function at(day: number, hh: number, mm: number): SimTime {
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) throw new RangeError(`Hour out of range: ${hh}`);
  if (!Number.isInteger(mm) || mm < 0 || mm > 59) throw new RangeError(`Minute out of range: ${mm}`);
  return day * DAY_SEC + hh * 3600 + mm * 60;
}

/** Throws RangeError unless the text is a real calendar date in YYYY-MM-DD form. */
export function parseIsoDate(text: string): IsoDate {
  const parts = parseCivil(text);
  if (!parts) throw new RangeError(`Not a valid ISO date: ${JSON.stringify(text)}`);
  return formatCivil(...parts);
}
