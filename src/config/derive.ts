import type { Calibration, CalibrationKey, Figure, Unit } from './calibration';
import type { IsoDate, SourceId } from './sources';

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

/** One step of a derivation: the inputs are calibration keys or earlier derived figures. */
type Input = CalibrationKey | DerivedFigure;

function derive(cal: Calibration, value: number, unit: Unit, inputs: readonly Input[], note: string): DerivedFigure {
  const keys = new Set<CalibrationKey>();
  const sources = new Set<SourceId>();
  let asOf: IsoDate = '0000-01-01';
  for (const input of inputs) {
    const fromKeys = typeof input === 'string' ? [input] : input.derivedFrom;
    for (const key of fromKeys) {
      keys.add(key);
      const f = cal[key] as Figure<unknown>;
      for (const s of f.sourceIds) sources.add(s);
      if (f.asOf > asOf) asOf = f.asOf;
    }
  }
  return { value, unit, tag: 'derived', derivedFrom: [...keys], sourceIds: [...sources].sort(), asOf, note };
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
  const pop2011Value = Object.values(cal.population2011ByWard.value).reduce((s, p) => s + p, 0);
  const population2011 = derive(cal, pop2011Value, 'people', ['population2011ByWard'], 'Sum of the 7 cluster wards (Census 2011).');
  const population2026 = derive(
    cal,
    pop2011Value * cal.growthFactor2011to2026.value,
    'people',
    [population2011, 'growthFactor2011to2026'],
    '2011 population × growth factor.',
  );
  const households = derive(
    cal,
    Math.round(population2026.value / cal.personsPerHousehold.value),
    'households',
    [population2026, 'personsPerHousehold'],
    'Population ÷ persons per household.',
  );
  const perCapitaKgPerDay = derive(
    cal,
    (cal.cityWasteTpd.value * 1000) / cal.cityPopulation2026.value,
    'kg/person/day',
    ['cityWasteTpd', 'cityPopulation2026'],
    'City waste ÷ city population.',
  );
  const wasteTpd = derive(cal, (population2026.value * perCapitaKgPerDay.value) / 1000, 't/day', [population2026, perCapitaKgPerDay], 'Population × per-capita waste.');
  const autoTippers = derive(
    cal,
    Math.ceil(households.value / cal.householdsPerAutoTipper.value),
    'count',
    [households, 'householdsPerAutoTipper'],
    '1 auto-tipper per 1,000 households, rounded up.',
  );
  const compactors = derive(
    cal,
    Math.ceil(wasteTpd.value / (cal.compactorPayloadT.value * cal.compactorTripsPerDay.value)),
    'count',
    [wasteTpd, 'compactorPayloadT', 'compactorTripsPerDay'],
    'Waste ÷ (payload × trips per day), rounded up.',
  );
  const blackSpots = derive(
    cal,
    Math.round((cal.cityBlackSpots.value * population2026.value) / cal.cityPopulation2026.value),
    'count',
    [population2026, 'cityBlackSpots', 'cityPopulation2026'],
    'City black spots scaled by population share.',
  );
  return { population2011, population2026, households, perCapitaKgPerDay, wasteTpd, autoTippers, compactors, blackSpots };
}
