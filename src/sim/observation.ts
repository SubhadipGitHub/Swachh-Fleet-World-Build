import type { WeatherMode } from '../config/scenario';
import type { SimTime } from './clock';
import type { ObservedReading } from './forecast';
import type { DailyProfile } from './generation';
import type { SensorReading } from './sensors';

/**
 * What a routing policy may see (AD-5, truth vs observation). It deliberately has no true fill levels, so the
 * dynamic policy cannot cheat. tests/unit/sim/observation.test.ts checks this at the type level.
 */
export interface BinObservation {
  readonly binId: number;
  readonly reading: SensorReading;
  readonly readAt: SimTime;
}

export interface FleetObservation {
  readonly vehicleId: number;
  readonly kind: 'auto-tipper' | 'compactor' | 'crew';
  readonly available: boolean;
}

export interface Observation {
  readonly t: SimTime;
  readonly bins: readonly BinObservation[];
  readonly fleet: readonly FleetObservation[];
  readonly closedEdges: readonly number[];
}

// --- M3: everything a Dynamic decision may use (architecture M3-D4) ---------------------------------------------

/** One sensored point's history as the operator sees it (readings with their status; no true fill). */
export interface SensorHistory {
  readonly binId: number;
  /** Transfer point whose container this is, or −1. */
  readonly tp: number;
  readonly history: readonly ObservedReading[];
}

export interface RosterEntry {
  readonly id: number;
  readonly kind: 'auto-tipper' | 'compactor' | 'crew';
  /** On shift today (not absent). */
  readonly present: boolean;
  readonly brokenDown: boolean;
  /** Where GPS last placed it, local metres. */
  readonly x: number;
  readonly y: number;
  readonly shiftStart: SimTime;
  readonly shiftEnd: SimTime;
  /** Its transfer point (tippers and compactors), else −1. */
  readonly tp: number;
}

/**
 * The only input to every Dynamic decision: sensor histories, the GPS service log, the fleet roster, closures,
 * black-spot sizes from their sensors, KCDC weigh-ins by day and the calendar. It deliberately has no true daily
 * rates, carried amounts or generator multipliers (risk R-4).
 */
export interface OperatorView extends Observation {
  readonly day: number;
  readonly weather: WeatherMode;
  readonly sensors: readonly SensorHistory[];
  /** GPS service log: when each segment was last served (0 if never). */
  readonly segmentsLastServedAt: readonly SimTime[];
  /** GPS service log: when each smart bin was last emptied, or null. */
  readonly binsLastServicedAt: readonly (SimTime | null)[];
  readonly roster: readonly RosterEntry[];
  /** Segments cut off by closures (none of their edges reachable from the depot). */
  readonly closedSegments: readonly number[];
  readonly spots: readonly { readonly id: number; readonly sizeKg: number | null; readonly activeSince: SimTime | null }[];
  /** Weighbridge kg by day (KCDC plus landfill), oldest first, today last. */
  readonly weighedKgByDay: readonly number[];
  /** Household-days collected by day, from the service log (households × days since the previous service). */
  readonly householdDaysByDay: readonly number[];
  /** Each tipper's streets still to do on the route it was given (the plan the operator issued, less GPS progress). */
  readonly assignments: readonly { readonly tipperId: number; readonly remaining: readonly number[] }[];
}

/**
 * Static facts an operator has: the map and today's practice (the static beats). Built once per world; not truth
 * about waste.
 */
export interface PlannerMap {
  readonly segments: readonly {
    readonly id: number;
    readonly households: number;
    readonly x: number;
    readonly y: number;
    readonly serviceSec: number;
    /** Segment ids sharing a junction with it. */
    readonly neighbours: readonly number[];
  }[];
  readonly transferPoints: readonly { readonly id: number; readonly x: number; readonly y: number }[];
  readonly depot: { readonly x: number; readonly y: number };
  /** Static beats: each tipper's segment ids in walk order, and its transfer point. */
  readonly beats: readonly { readonly tipperId: number; readonly segments: readonly number[]; readonly tp: number }[];
  /** Smart bins and the segment each sits on (bins follow their street, M3-D6 step 5). */
  readonly binSegments: readonly number[];
  /** Black spots and the segments that feed them. */
  readonly spotSegments: readonly (readonly number[])[];
  /** The published household daily curve. */
  readonly householdProfile: DailyProfile;
  /** Weekday of t = 0 (0 = Monday). */
  readonly startWeekday: number;
  /** Prior for r̂: kg per household per day. */
  readonly rPrior: number;
  readonly tipperPayloadKg: number;
  /** Tipper shift window, seconds of day. */
  readonly tipperShift: readonly [number, number];
}
