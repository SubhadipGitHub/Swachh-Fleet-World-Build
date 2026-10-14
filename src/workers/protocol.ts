import type { RoutingPolicy, WeatherMode } from '../config/scenario';
import type { IsoDate } from '../config/sources';
import type { SnapshotFiles, WardShape } from '../geo/snapshot';
import type { Alert } from '../sim/alerts';
import type { DayPlan, PlanRequest } from '../sim/policies/types';
import type { Timeline, TrackerStep, VehicleExplain, VehicleKind, VehiclePlan, VehicleView, WorldKpis } from '../sim/world';

/** What the process tracker follows (D-5). */
export interface TrackerSelection {
  readonly kind: 'bin' | 'transferPoint' | 'vehicle';
  readonly id: number;
}

/** Messages from the view to the simulation host (architecture AD-8). Every field is validated by the engine. */
export type ToSim =
  | {
      readonly type: 'init';
      readonly files: SnapshotFiles;
      readonly seed: number;
      readonly startDate: IsoDate;
      readonly startAtSec: number;
    }
  | { readonly type: 'setSpeed'; readonly speed: number }
  | { readonly type: 'setPaused'; readonly paused: boolean }
  | { readonly type: 'skipTo'; readonly secondOfDay: number; readonly reqId: number }
  | { readonly type: 'skipToMorning'; readonly reqId: number }
  | { readonly type: 'select'; readonly vehicleId: number | null }
  | { readonly type: 'setWeather'; readonly weather: WeatherMode }
  | { readonly type: 'selectObject'; readonly target: TrackerSelection | null }
  /** M3-1 (validated). */
  | { readonly type: 'setPolicy'; readonly policy: RoutingPolicy };

/** Hourly samples of the live KPIs for the sparklines (M2-2), oldest first, at most 24. */
export interface KpiTrend {
  readonly overflowing: readonly number[];
  readonly fuelPerTonne: readonly (number | null)[];
  readonly coverage: readonly (number | null)[];
}

export interface BinTableRow {
  readonly binIndex: number;
  readonly displayId: string;
  readonly kind: string;
  readonly ward: string;
  readonly reportedPct: number | null;
  readonly predictedFullAt: number | null;
  readonly lastServicedAt: number | null;
  readonly sensorStatus: string;
}

export interface FleetTableRow {
  readonly vehicleIndex: number;
  readonly displayId: string;
  readonly kind: VehicleKind;
  readonly state: string;
  readonly loadKg: number;
  readonly fuelLitres: number;
  readonly kmToday: number;
  readonly skippedToday: number;
}

export interface RouteTableRow {
  readonly vehicleIndex: number;
  /** R-<YYYY-MM-DD>-<nnn> (D-7). */
  readonly routeId: string;
  readonly vehicleDisplayId: string;
  readonly stopsDone: number;
  readonly stopsPlanned: number;
  readonly kmPlanned: number;
  readonly kmActual: number;
  readonly deviations: number;
  readonly etaAt: number | null;
  /** M3-D12. */
  readonly policy: RoutingPolicy;
  readonly replans: number;
}

export interface FacilityView {
  readonly kind: 'depot' | 'kcdc' | 'weighbridge' | 'dwcc' | 'transfer-point' | 'landfill-exit';
  readonly id: number;
  readonly displayId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** "real" when placed at its OSM location, "assumed" for a plausible site (W-3). */
  readonly location: 'real' | 'assumed';
}

export interface MapView {
  readonly startDate: IsoDate;
  readonly facilities: readonly FacilityView[];
  readonly bins: readonly { readonly id: number; readonly kind: string; readonly displayId: string; readonly x: number; readonly y: number; readonly capacityKg: number }[];
  readonly blackSpots: readonly { readonly id: number; readonly displayId: string; readonly x: number; readonly y: number }[];
  readonly vehicles: readonly { readonly id: number; readonly kind: VehicleKind; readonly displayId: string; readonly lengthM: number }[];
  readonly wards: readonly WardShape[];
  readonly households: number;
  readonly fetchedAt: IsoDate;
  /** M2-5: flood-prone spots (assumed), for alerts and the rain view. */
  readonly floodSpots: readonly { readonly id: number; readonly x: number; readonly y: number }[];
}

/** Per-vehicle frame record (Float32, stride FRAME_STRIDE). */
export const FRAME_STRIDE = 8;
export const F = { x: 0, y: 1, heading: 2, speed: 3, visible: 4, state: 5, load: 6, edge: 7 } as const;

export const STATE_NAMES = [
  'OffShift',
  'Absent',
  'ToBeat',
  'Driving',
  'Serving',
  'ToTransfer',
  'Tipping',
  'ToDepot',
  'BrokenDown',
  'Deviating',
  'ToTransferPoint',
  'Queued',
  'Loading',
  'ToKCDC',
  'Weighing',
  'Unloading',
  'ToLandfill',
  'Idle',
  'ToBlackSpot',
  'Clearing',
  'ToDisposal',
  // M3-D7
  'Waiting',
] as const;

export type FromSim =
  | { readonly type: 'ready'; readonly view: MapView; readonly t: number }
  | {
      readonly type: 'frame';
      readonly t: number;
      readonly vehicles: Float32Array;
      /** Per bin: reported fill % (−1 when no reading), true fill %. */
      readonly bins: Float32Array;
      /** Per black spot: size in kg (0 when dormant). */
      readonly spots: Float32Array;
      readonly reqId: number | null;
    }
  | { readonly type: 'detail'; readonly vehicle: VehicleView; readonly plan: VehiclePlan; /** M3-10, tippers only. */ readonly explain: VehicleExplain | null }
  | {
      /** M2-15, at 2 Hz. */
      readonly type: 'dashboard';
      readonly t: number;
      readonly weather: WeatherMode;
      /** M3-1. */
      readonly policy: RoutingPolicy;
      /** M3-D5: running mean absolute forecast error (fill points), or null before any forecast was scored. */
      readonly forecastMae: number | null;
      readonly kpis: { readonly live: WorldKpis; readonly twin: WorldKpis; readonly trend: KpiTrend };
      readonly tables: { readonly bins: readonly BinTableRow[]; readonly fleet: readonly FleetTableRow[]; readonly routes: readonly RouteTableRow[] };
      /** Alerts raised since the previous dashboard message, oldest first. */
      readonly alerts: readonly Alert[];
      readonly tracker: { readonly selection: TrackerSelection | null; readonly timeline: Timeline | null; readonly counts: Readonly<Record<TrackerStep, number>> };
    }
  | { readonly type: 'error'; readonly message: string };

/** M3-D9: the solver channel between the sim worker and the solver worker. */
export type ToSolver = { readonly type: 'solve'; readonly request: PlanRequest };
export type FromSolver = { readonly type: 'plan'; readonly plan: DayPlan } | { readonly type: 'planError'; readonly reqId: number; readonly message: string };

/**
 * Main thread → workers (M3-D9): hands one end of the solver channel to the sim worker (`connect`) and the other to
 * the solver worker; `lost` tells the sim worker the solver worker failed, so it plans inline.
 */
export type SolverConnect = { readonly type: 'connect'; readonly port: MessagePort } | { readonly type: 'lost' };
