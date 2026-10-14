import type { Calibration, CalibrationKey, Figure, Unit, WasteComposition } from '../config/calibration';
import type { ClusterScale } from '../config/derive';
import { sourceMeta, type IsoDate, type SourceId, type Tag } from '../config/sources';
import type { SnapshotManifest } from '../geo/snapshot';

export interface DataSourceRow {
  readonly group: 'Calibration' | 'Derived' | 'Map snapshot' | 'Simulation';
  /** Calibration or ClusterScale key, or a fixed key for the snapshot and simulation rows. */
  readonly key: string;
  readonly label: string;
  /** Formatted value with its unit, e.g. "5,500 t/day". */
  readonly value: string;
  readonly tag: Tag;
  readonly sources: readonly { readonly title: string; readonly url: string | null }[];
  readonly asOf: IsoDate;
  readonly note?: string;
  /** Conflicting published values (P-4), formatted. */
  readonly alternatives?: readonly string[];
  /** For derived rows: the labels of the figures it comes from. */
  readonly derivedFrom?: readonly string[];
}

const LABELS: Readonly<Record<CalibrationKey | keyof ClusterScale, string>> = {
  population2011ByWard: 'Ward populations (Census 2011)',
  growthFactor2011to2026: 'Population growth 2011–2026',
  personsPerHousehold: 'Persons per household',
  cityWasteTpd: 'Waste handled city-wide',
  cityPopulation2026: 'City population 2026',
  householdsPerAutoTipper: 'Households per auto-tipper',
  compactorPayloadT: 'Compactor payload',
  compactorTripsPerDay: 'Compactor trips per day',
  cityBlackSpots: 'Black spots city-wide',
  wasteComposition: 'Waste composition',
  transferPoints: 'Transfer points',
  smartBins: 'Smart bins',
  tipperAbsenceRate: 'Auto-tippers absent each day',
  kcdcIntakeCapTpd: 'KCDC daily intake cap',
  freeFlowRefSpeedKmh: 'Free-flow reference speed',
  morningPeakSpeedKmh: 'Morning rush-hour speed',
  eveningPeakSpeedKmh: 'Evening rush-hour speed',
  dieselPriceInrPerL: 'Diesel price',
  skipChance: 'Streets skipped by drivers (calibrated)',
  earlyReturnChance: 'Shifts ended early (calibrated)',
  leakageSharePerDay: 'Stale backlog leaving the system each day (calibrated)',
  breakdownChancePerShift: 'Breakdowns per vehicle shift',
  generationSigma: 'Day-to-day waste variability',
  dumpRadiusM: 'Dumping radius around black spots',
  compactorDispatchPct: 'Dynamic compactor dispatch threshold',
  criticalSpotKg: 'Critical black-spot size (daytime clearance)',
  priorityWeightBacklog: 'Dynamic priority weight: backlog',
  priorityWeightAge: 'Dynamic priority weight: days since served',
  priorityWeightRisk: 'Dynamic priority weight: black-spot risk',
  population2011: 'Cluster population (2011)',
  population2026: 'Cluster population (2026)',
  households: 'Households',
  perCapitaKgPerDay: 'Waste per person per day',
  wasteTpd: 'Waste generated in the cluster',
  autoTippers: 'Auto-tippers',
  compactors: 'Compactors',
  blackSpots: 'Black spots in the cluster',
};

const num = (n: number, digits = 2): string => n.toLocaleString('en-IN', { maximumFractionDigits: digits });

function formatValue(value: number, unit: Unit): string {
  switch (unit) {
    case 'fraction':
      return `${num(value * 100, 1)}%`;
    case 'factor':
      return `× ${num(value)}`;
    case 'INR/L':
      return `₹${num(value)} per litre`;
    case 'count':
      return num(value, 0);
    case '%':
      return `${num(value)}%`;
    case 'weight':
      return `weight ${num(value)}`;
    default:
      return `${num(value)} ${unit}`;
  }
}

function formatFigure(f: Figure<unknown>): string {
  if (f.unit === 'composition') {
    const c = f.value as WasteComposition;
    return `${num(c.wet * 100, 0)}% wet, ${num(c.dry * 100, 0)}% dry, ${num(c.reject * 100, 0)}% reject`;
  }
  if (typeof f.value === 'object' && f.value !== null) {
    const values = Object.values(f.value as Record<string, number>);
    return `${values.length} wards, ${num(values.reduce((a, v) => a + v, 0), 0)} ${f.unit}`;
  }
  return formatValue(f.value as number, f.unit);
}

const sourcesOf = (ids: readonly SourceId[]): { title: string; url: string | null }[] =>
  ids.map((id) => {
    const m = sourceMeta(id);
    return { title: m.title, url: m.url };
  });

/**
 * The Data sources dialog's rows (D-9, M2-12): every calibration figure, every derived figure, the OSM snapshot
 * (key "osm-snapshot": fetch date, ODbL, counts and coverage) and the simulated streams (key "simulation", tagged
 * synthetic).
 */
export function dataSourceRows(cal: Calibration, scale: ClusterScale, manifest: SnapshotManifest): DataSourceRow[] {
  const rows: DataSourceRow[] = [];
  for (const key of Object.keys(cal) as CalibrationKey[]) {
    const f = cal[key] as Figure<unknown>;
    rows.push({
      group: 'Calibration',
      key,
      label: LABELS[key],
      value: formatFigure(f),
      tag: f.tag,
      sources: sourcesOf(f.sourceIds),
      asOf: f.asOf,
      ...(f.note !== undefined ? { note: f.note } : {}),
      ...(f.alternatives ? { alternatives: f.alternatives.map((a) => `${formatFigure(a)} (${a.note ?? a.asOf})`) } : {}),
    });
  }
  for (const key of Object.keys(scale) as (keyof ClusterScale)[]) {
    const f = scale[key];
    rows.push({
      group: 'Derived',
      key,
      label: LABELS[key],
      value: formatValue(f.value, f.unit),
      tag: f.tag,
      sources: sourcesOf(f.sourceIds),
      asOf: f.asOf,
      ...(f.note !== undefined ? { note: f.note } : {}),
      derivedFrom: f.derivedFrom.map((k) => LABELS[k]),
    });
  }
  const c = manifest.counts;
  rows.push({
    group: 'Map snapshot',
    key: 'osm-snapshot',
    label: 'OpenStreetMap snapshot',
    value: `${num(c.buildings, 0)} buildings, ${num(c.roadWays, 0)} road ways, ${num(c.pois, 0)} places · ODbL 1.0`,
    tag: 'real',
    sources: sourcesOf(['osm-snapshot']),
    asOf: manifest.fetchedAt,
    note: `${manifest.attribution}. ${num(manifest.coverage.buildingsWithLevelsPct, 1)}% of buildings have a height tag; sparse wards: ${manifest.coverage.sparseWards.join(', ') || 'none'}.`,
  });
  const sim = sourceMeta('kasaflow-simulation');
  rows.push({
    group: 'Simulation',
    key: 'simulation',
    label: 'Live sensor readings, vehicle positions, attendance and breakdowns',
    value: 'Generated by the seeded simulation',
    tag: 'synthetic',
    sources: sourcesOf(['kasaflow-simulation']),
    asOf: sim.asOf,
    note: 'No public live feed exists; these streams are simulated and calibrated to the figures above.',
  });
  return rows;
}
