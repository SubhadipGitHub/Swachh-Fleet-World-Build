import { getCalibration } from '../../config/calibration';
import type { SimTime } from '../clock';

/**
 * Dynamic compactor dispatch (architecture M3-D7): a rolling dispatcher, run at each sensor round and whenever a
 * compactor becomes free. Each free compactor goes to the transfer point that is most urgent at its arrival, if that
 * urgency is at least the threshold. Each point gets at most one compactor per call.
 */

export interface TransferPointOutlook {
  readonly tp: number;
  /** Forecast container fill (%) at a time. */
  predictPct(at: SimTime): number;
  /** Tippers queued at the point or due there before the compactor would arrive. */
  readonly tippersDue: number;
}

export interface FreeCompactor {
  readonly id: number;
  /** Estimated seconds to drive to a transfer point. */
  travelSecTo(tp: number): number;
}

export interface DispatchOptions {
  /** Default 80 (`assumed`). */
  readonly thresholdPct: number;
  /** Urgency added per tipper due: a tipper load as a share of the container (1,000 / 6,000 kg ≈ 16.7 points). */
  readonly pctPerTipper: number;
}

export const DEFAULT_DISPATCH: DispatchOptions = { thresholdPct: getCalibration().compactorDispatchPct.value, pctPerTipper: (100 * 1000) / 6000 };

/** Urgency at arrival: forecast fill then plus `pctPerTipper` for each tipper due. */
export function urgencyAt(tp: TransferPointOutlook, arrival: SimTime, options: DispatchOptions = DEFAULT_DISPATCH): number {
  return tp.predictPct(arrival) + tp.tippersDue * options.pctPerTipper;
}

/**
 * Assignments, most urgent first. Compactors are taken in id order; each picks the point with the highest urgency at
 * its own arrival among the points not yet assigned, ties broken by travel time then point id. A compactor whose best
 * urgency is below the threshold stays free.
 */
export function dispatchCompactors(
  now: SimTime,
  free: readonly FreeCompactor[],
  tps: readonly TransferPointOutlook[],
  options: DispatchOptions = DEFAULT_DISPATCH,
): { readonly compactorId: number; readonly tp: number }[] {
  const out: { compactorId: number; tp: number }[] = [];
  const taken = new Set<number>();
  for (const c of [...free].sort((a, b) => a.id - b.id)) {
    let best: { tp: number; urgency: number; travel: number } | null = null;
    for (const p of tps) {
      if (taken.has(p.tp)) continue;
      const travel = c.travelSecTo(p.tp);
      const urgency = urgencyAt(p, now + travel, options);
      const better = !best || urgency > best.urgency || (urgency === best.urgency && (travel < best.travel || (travel === best.travel && p.tp < best.tp)));
      if (better) best = { tp: p.tp, urgency, travel };
    }
    if (!best || best.urgency < options.thresholdPct) continue;
    taken.add(best.tp);
    out.push({ compactorId: c.id, tp: best.tp });
  }
  return out;
}
