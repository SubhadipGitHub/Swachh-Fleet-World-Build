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
  | 'composition'
  // M3
  | 'm'
  | 'kg'
  | '%'
  | 'weight';

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
  readonly dieselPriceInrPerL: Figure;
  // M3: the calibrated baseline (M3-D3) and the Dynamic policy's assumptions (M3-D2, M3-D6 to M3-D8, M3-11).
  readonly skipChance: Figure;
  readonly earlyReturnChance: Figure;
  readonly leakageSharePerDay: Figure;
  readonly breakdownChancePerShift: Figure;
  readonly generationSigma: Figure;
  readonly dumpRadiusM: Figure;
  readonly compactorDispatchPct: Figure;
  readonly criticalSpotKg: Figure;
  readonly priorityWeightBacklog: Figure;
  readonly priorityWeightAge: Figure;
  readonly priorityWeightRisk: Figure;
}

export type CalibrationKey = keyof Calibration;

const STAGE2: IsoDate = '2026-10-14';

function assumed(value: number, unit: Unit, note: string): Figure {
  return { value, unit, tag: 'assumed', sourceIds: ['kasaflow-assumptions'], asOf: STAGE2, note };
}

/** M3-D3: a value set by `scripts/calibrate.ts` so the Static baseline collects 50–60% (B.PAC 2023, "< 60%"). */
function calibrated(value: number, unit: Unit, note: string): Figure {
  return { value, unit, tag: 'derived', sourceIds: ['bpac-2023-collection', 'kasaflow-assumptions'], asOf: STAGE2, note };
}

/** The calibrated non-compliance intensity k (M3-D3): skip chance = k, early-return chance = k ÷ 2. */
const NON_COMPLIANCE_K = 0.373;
/** Calibrated share of stale (over 48 h) backlog that leaves the system each day. */
const LEAKAGE_SHARE = 0.45;

const CALIBRATION: Calibration = {
  population2011ByWard: {
    value: {
      'South-29': 27_879,
      'South-28': 22_885,
      'South-30': 25_594,
      'South-72': 18_787,
      'South-71': 18_836,
      'South-68': 23_783,
      'South-69': 18_834,
    },
    unit: 'people',
    tag: 'real',
    sourceIds: ['gba-wards-dec2025'],
    asOf: '2025-12-01',
    note: 'Census 2011 ward populations used by the GBA 2025 delimitation (TOT_P).',
  },
  growthFactor2011to2026: assumed(1.6, 'factor', "Placeholder for Bengaluru's growth since the 2011 Census; to source in M1."),
  personsPerHousehold: assumed(3.9, 'persons/household', 'Typical urban Karnataka household size; to source in M1.'),
  cityWasteTpd: { value: 5_500, unit: 't/day', tag: 'real', sourceIds: ['bswml-dh-5500tpd'], asOf: '2026-01-01' },
  cityPopulation2026: assumed(14_000_000, 'people', 'Placeholder city population for per-capita waste and black-spot scaling; to source in M1.'),
  householdsPerAutoTipper: { value: 1_000, unit: 'households/vehicle', tag: 'real', sourceIds: ['bbmp-autotipper-ratio'], asOf: '2020-01-01' },
  compactorPayloadT: assumed(6, 't', 'Typical urban compactor load.'),
  compactorTripsPerDay: assumed(3, 'trips/day', 'Typical for a ~10 km haul to KCDC.'),
  cityBlackSpots: { value: 1_555, unit: 'count', tag: 'real', sourceIds: ['shubra-blackspots-1555'], asOf: '2024-01-01' },
  wasteComposition: {
    value: { wet: 0.6, dry: 0.3, reject: 0.1 },
    unit: 'composition',
    tag: 'assumed',
    sourceIds: ['kasaflow-assumptions'],
    asOf: STAGE2,
    note: 'Typical Indian urban municipal solid waste split.',
  },
  transferPoints: assumed(5, 'count', 'No public list of secondary transfer points was found for the cluster.'),
  smartBins: assumed(120, 'count', 'Scenario lever: markets, commercial streets, transfer points and black spots.'),
  tipperAbsenceRate: {
    value: 0.05,
    unit: 'fraction',
    tag: 'derived',
    sourceIds: ['dh-absent-vehicles'],
    asOf: '2026-01-01',
    note: '200–300 vehicles absent a day out of a city fleet of several thousand, about 4–7%.',
  },
  kcdcIntakeCapTpd: {
    value: 100,
    unit: 't/day',
    tag: 'real',
    sourceIds: ['kcdc-capacity'],
    asOf: '2023-01-01',
    note: 'Intake reported by BBMP. Other published figures are kept as alternatives (P-4).',
    alternatives: [
      { value: 60, unit: 't/day', tag: 'real', sourceIds: ['kcdc-capacity'], asOf: '2017-01-01', note: 'Installed capacity per the residents’ federation.' },
      { value: 150, unit: 't/day', tag: 'real', sourceIds: ['kcdc-capacity'], asOf: '2023-01-01', note: 'Higher reported intake.' },
      { value: 500, unit: 't/day', tag: 'real', sourceIds: ['kcdc-capacity'], asOf: '2023-01-01', note: 'Highest claim reported.' },
    ],
  },
  freeFlowRefSpeedKmh: assumed(30, 'km/h', 'Uncongested urban arterial speed the TomTom averages are compared with.'),
  morningPeakSpeedKmh: { value: 14.6, unit: 'km/h', tag: 'real', sourceIds: ['tomtom-2025'], asOf: '2026-01-15' },
  eveningPeakSpeedKmh: { value: 13.2, unit: 'km/h', tag: 'real', sourceIds: ['tomtom-2025'], asOf: '2026-01-15' },
  dieselPriceInrPerL: assumed(89, 'INR/L', 'Approximate Bengaluru retail diesel price, used for the fuel cost sub-line; to source.'),
  skipChance: calibrated(NON_COMPLIANCE_K, 'fraction', 'Chance a street is skipped by a non-compliant driver, calibrated (intensity k) so the Static baseline collects 50–60% of the waste.'),
  earlyReturnChance: calibrated(NON_COMPLIANCE_K / 2, 'fraction', 'Chance a tipper ends its shift early (half the skip chance, assumed ratio), calibrated with the skip chance.'),
  leakageSharePerDay: calibrated(LEAKAGE_SHARE, 'fraction', 'Share of backlog older than 48 h that leaves the system each day (informal collection, burning), set so the backlog levels off.'),
  breakdownChancePerShift: assumed(0.01, 'fraction', 'Chance a vehicle breaks down in a shift (about one tipper in a hundred a day); not calibrated.'),
  generationSigma: assumed(0.2, 'factor', 'Day-to-day variability of each street’s and bin’s waste (lognormal, mean 1), so forecasts cannot learn the generator exactly.'),
  dumpRadiusM: assumed(500, 'm', 'Waste left over 48 h is dumped at the nearest black spot within this distance.'),
  compactorDispatchPct: assumed(80, '%', 'Dynamic sends a compactor to a transfer point forecast to reach this fill by its arrival.'),
  criticalSpotKg: assumed(1500, 'kg', 'A black spot this big may be cleared in daytime under Dynamic; others wait for the 19:00–21:00 clearance hours.'),
  priorityWeightBacklog: assumed(1, 'weight', 'Street priority weight on predicted backlog (in days of waste), M3-11.'),
  priorityWeightAge: assumed(1, 'weight', 'Street priority weight on days since last served, M3-11.'),
  priorityWeightRisk: assumed(0.5, 'weight', 'Street priority weight on black-spot risk (1 next to an active spot, 0.3 a dormant one), M3-11.'),
};

/** The app's calibration config (requirements W-5, data-sources §2–§4). */
export function getCalibration(): Calibration {
  return CALIBRATION;
}
