import type { SimTime } from './clock';
import type { BlackSpotState } from './agents/black-spot';

export interface OverflowInput {
  readonly bins: readonly { readonly trueFillPct: number }[];
  readonly blackSpots: readonly BlackSpotState[];
}

/** K-1: sensored bins with true fill ≥ 100% plus black spots that are Active or Clearing. */
export function overflowingPoints(input: OverflowInput): { readonly total: number; readonly binsFull: number; readonly blackSpotsActive: number } {
  const binsFull = input.bins.filter((b) => b.trueFillPct >= 100).length;
  const blackSpotsActive = input.blackSpots.filter((s) => s.kind !== 'Dormant').length;
  return { total: binsFull + blackSpotsActive, binsFull, blackSpotsActive };
}

/** K-1 overflow-hours added over one step: (bins at ≥ 100%) × dtSec ÷ 3600. */
export function overflowHoursIncrement(bins: readonly { readonly trueFillPct: number }[], dtSec: number): number {
  let full = 0;
  for (const b of bins) if (b.trueFillPct >= 100) full++;
  return (full * dtSec) / 3600;
}

/** K-2: litres ÷ tonnes delivered (KCDC plus landfill). Null when nothing has been delivered yet. */
export function fuelPerTonne(litres: number, tonnesDelivered: number): number | null {
  return tonnesDelivered > 0 ? litres / tonnesDelivered : null;
}

/** K-2 sub-line: fuel cost in ₹. */
export function fuelCostInr(litres: { readonly diesel: number; readonly cng: number }, pricePerLitre: { readonly diesel: number; readonly cng: number }): number {
  return litres.diesel * pricePerLitre.diesel + litres.cng * pricePerLitre.cng;
}

export interface ScheduledJob {
  readonly windowStart: SimTime;
  readonly windowEnd: SimTime;
  /** When it was served, or null if not (yet). */
  readonly servicedAt: SimTime | null;
}

/** K-3: jobs served within [windowStart, windowEnd] ÷ jobs scheduled, as a percentage. pct is null when nothing is scheduled. */
export function onTimeCoverage(jobs: readonly ScheduledJob[]): { readonly pct: number | null; readonly onTime: number; readonly scheduled: number } {
  const onTime = jobs.filter((j) => j.servicedAt !== null && j.servicedAt >= j.windowStart && j.servicedAt <= j.windowEnd).length;
  return { pct: jobs.length > 0 ? (100 * onTime) / jobs.length : null, onTime, scheduled: jobs.length };
}

/** Live value against the shadow twin (D8): absolute difference, and percentage difference (null when the twin is 0). */
export function deltaVsTwin(live: number, twin: number): { readonly abs: number; readonly pct: number | null } {
  return { abs: live - twin, pct: twin !== 0 ? (100 * (live - twin)) / twin : null };
}
