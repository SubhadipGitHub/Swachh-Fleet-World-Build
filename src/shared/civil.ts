/**
 * Proleptic Gregorian calendar arithmetic without `Date` (the pure layers may not use it, AD-5).
 * Algorithms from Howard Hinnant, "chrono-Compatible Low-Level Date Algorithms".
 */

/** Days since 1970-01-01 for a civil date. */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** Civil date for days since 1970-01-01. */
export function civilFromDays(days: number): [y: number, m: number, d: number] {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

export function daysInMonth(y: number, m: number): number {
  return daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

export function formatCivil(y: number, m: number, d: number): `${number}-${number}-${number}` {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` as `${number}-${number}-${number}`;
}

/** Parses YYYY-MM-DD strictly. Returns null if malformed or not a real date. */
export function parseCivil(text: string): [y: number, m: number, d: number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return [y, m, d];
}
