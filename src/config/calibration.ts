import { notImplemented } from '../shared/not-implemented';
import type { IsoDate, SourceId, Tag } from './sources';

export type Unit =
  | 'people'
  | 'households'
  | 'persons/household'
  | 'kg/person/day'
  | 't/day'
  | 't'
  | 'households/vehicle'
  | 'trips/day'
  | 'count'
  | 'fraction'
  | 'factor'
  | 'km/h'
  | 'INR/L'
  | 'composition';

/** One calibration value with its provenance (requirements P-1, architecture AD-9). */
export interface Figure<T = number> {
  readonly value: T;
  readonly unit: Unit;
  readonly tag: Tag;
  readonly sourceIds: readonly SourceId[];
  readonly asOf: IsoDate;
  /** Required for `assumed` figures: why this value. */
  readonly note?: string;
  /** Conflicting published values kept for the lab (P-4). */
  readonly alternatives?: readonly Figure<T>[];
}

/** The 7 cluster wards (requirements D1). Keys are `<corporation>-<ward number>`, since numbers repeat across corporations. */
export const CLUSTER_WARDS = [
  { key: 'South-29', corporation: 'South', ward: 29, name: 'Kormangala West' },
  { key: 'South-28', corporation: 'South', ward: 28, name: 'Kormangala East' },
  { key: 'South-30', corporation: 'South', ward: 30, name: 'Jakkasandra' },
  { key: 'South-72', corporation: 'South', ward: 72, name: 'HSR Layout' },
  { key: 'South-71', corporation: 'South', ward: 71, name: 'Agara' },
  { key: 'South-68', corporation: 'South', ward: 68, name: 'Mangammana Palya' },
  { key: 'South-69', corporation: 'South', ward: 69, name: 'Hosapalya' },
] as const;

export type WardKey = (typeof CLUSTER_WARDS)[number]['key'];

export interface WasteComposition {
  readonly wet: number;
  readonly dry: number;
  readonly reject: number;
}

export interface Calibration {
  readonly population2011ByWard: Figure<Readonly<Record<WardKey, number>>>;
  readonly growthFactor2011to2026: Figure;
  readonly personsPerHousehold: Figure;
  readonly cityWasteTpd: Figure;
  readonly cityPopulation2026: Figure;
  readonly householdsPerAutoTipper: Figure;
  readonly compactorPayloadT: Figure;
  readonly compactorTripsPerDay: Figure;
  readonly cityBlackSpots: Figure;
  readonly wasteComposition: Figure<WasteComposition>;
  readonly transferPoints: Figure;
  readonly smartBins: Figure;
  readonly tipperAbsenceRate: Figure;
  readonly kcdcIntakeCapTpd: Figure;
  readonly freeFlowRefSpeedKmh: Figure;
  readonly morningPeakSpeedKmh: Figure;
  readonly eveningPeakSpeedKmh: Figure;
}

export type CalibrationKey = keyof Calibration;

/** The app's calibration config (requirements W-5, data-sources §2–§4). */
export function getCalibration(): Calibration {
  return notImplemented('getCalibration');
}
