import { notImplemented } from '../shared/not-implemented';
import type { SimTime } from './clock';
import type { BlackSpotState } from './agents/black-spot';

export interface OverflowInput {
  readonly bins: readonly { readonly trueFillPct: number }[];
  readonly blackSpots: readonly BlackSpotState[];
}

/** K-1: sensored bins with true fill ≥ 100% plus black spots that are Active or Clearing. */
export function overflowingPoints(input: OverflowInput): { readonly total: number; readonly binsFull: number; readonly blackSpotsActive: number } {
  return notImplemented('overflowingPoints', input);
}

/** K-1 overflow-hours added over one step: (bins at ≥ 100%) × dtSec ÷ 3600. */
export function overflowHoursIncrement(bins: readonly { readonly trueFillPct: number }[], dtSec: number): number {
  return notImplemented('overflowHoursIncrement', bins, dtSec);
}

/** K-2: litres ÷ tonnes delivered (KCDC plus landfill). Null when nothing has been delivered yet. */
export function fuelPerTonne(litres: number, tonnesDelivered: number): number | null {
  return notImplemented('fuelPerTonne', litres, tonnesDelivered);
}

/** K-2 sub-line: fuel cost in ₹. */
export function fuelCostInr(litres: { readonly diesel: number; readonly cng: number }, pricePerLitre: { readonly diesel: number; readonly cng: number }): number {
  return notImplemented('fuelCostInr', litres, pricePerLitre);
}

export interface ScheduledJob {
  readonly windowStart: SimTime;
  readonly windowEnd: SimTime;
  /** When it was served, or null if not (yet). */
  readonly servicedAt: SimTime | null;
}

/** K-3: jobs served within [windowStart, windowEnd] ÷ jobs scheduled, as a percentage. pct is null when nothing is scheduled. */
export function onTimeCoverage(jobs: readonly ScheduledJob[]): { readonly pct: number | null; readonly onTime: number; readonly scheduled: number } {
  return notImplemented('onTimeCoverage', jobs);
}

/** Live value against the shadow twin (D8): absolute difference, and percentage difference (null when the twin is 0). */
export function deltaVsTwin(live: number, twin: number): { readonly abs: number; readonly pct: number | null } {
  return notImplemented('deltaVsTwin', live, twin);
}
