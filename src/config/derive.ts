import { notImplemented } from '../shared/not-implemented';
import type { Calibration, CalibrationKey, Figure } from './calibration';

/**
 * A figure computed from other figures (AD-9). `derivedFrom` lists every calibration key it depends on, transitively,
 * and `sourceIds` is the de-duplicated union of those figures' sources.
 */
export interface DerivedFigure extends Figure {
  readonly tag: 'derived';
  readonly derivedFrom: readonly CalibrationKey[];
}

/** The cluster's scale (requirements W-5), computed from the config and never typed in. */
export interface ClusterScale {
  readonly population2011: DerivedFigure;
  readonly population2026: DerivedFigure;
  readonly households: DerivedFigure;
  readonly perCapitaKgPerDay: DerivedFigure;
  readonly wasteTpd: DerivedFigure;
  readonly autoTippers: DerivedFigure;
  readonly compactors: DerivedFigure;
  readonly blackSpots: DerivedFigure;
}

/**
 * Rules (requirements W-5):
 * - population2011 = sum of the cluster wards' 2011 populations
 * - population2026 = population2011 × growth factor
 * - households = round(population2026 ÷ persons per household)
 * - perCapitaKgPerDay = city waste (t/day) × 1000 ÷ city population
 * - wasteTpd = population2026 × perCapitaKgPerDay ÷ 1000
 * - autoTippers = ceil(households ÷ households per auto-tipper)
 * - compactors = ceil(wasteTpd ÷ (payload × trips per day))
 * - blackSpots = round(city black spots × population2026 ÷ city population)
 */
export function deriveClusterScale(cal: Calibration): ClusterScale {
  return notImplemented('deriveClusterScale', cal);
}
