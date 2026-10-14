import { getCalibration } from '../../config/calibration';
import type { DeferReason, PlanReason } from '../../routing/vrp/beats-dynamic';
import type { SimTime } from '../clock';
import type { PlanCause } from '../events';
import type { Confidence } from '../forecast';
import type { OperatorView, PlannerMap } from '../observation';

/** The planner contract (architecture M3-D9): a pure function of the request. */

export interface PlanRequest {
  readonly reqId: number;
  readonly cause: PlanCause;
  /** When the inputs were frozen (05:00, or the incident time). */
  readonly madeAt: SimTime;
  /** When the plan takes effect (05:30, or the incident time + 300 s). */
  readonly dueAt: SimTime;
  readonly view: OperatorView;
  readonly map: PlannerMap;
  /** Local-search moves allowed. */
  readonly budget: number;
  /** Tippers whose routes may change: every present tipper for the daily plan, the affected ones for incidents. */
  readonly vehicleIds: readonly number[];
}

/** One street on a Dynamic route, with why it is there (M3-10). */
export interface PlannedStop {
  readonly segmentId: number;
  readonly reason: PlanReason;
  readonly predictedKg: number;
  readonly hoursSinceServed: number;
  readonly confidence: Confidence;
}

export interface Deferral {
  readonly segmentId: number;
  readonly reason: DeferReason;
  /** The street was must-serve (a fairness alert fires). */
  readonly mustServe: boolean;
}

export interface DayPlan {
  readonly reqId: number;
  readonly routes: readonly { readonly vehicleId: number; readonly stops: readonly PlannedStop[] }[];
  readonly deferred: readonly Deferral[];
  readonly iterations: number;
}

export type PlanResult = DayPlan | { readonly reqId: number; readonly error: string };

export type Planner = (req: PlanRequest) => DayPlan;

/** Iteration budgets (M3-D9), tuned so the 05:30 plan takes ≤ 2 s and a re-plan ≤ 0.5 s on the dev laptop. */
export const DAILY_BUDGET = 150_000;
export const REPLAN_BUDGET = 30_000;
/** Plans freeze their inputs at 05:00 and take effect at 05:30; incident re-plans take effect 300 s later. */
export const DAILY_CUTOFF_SEC = 5 * 3600;
export const DAILY_PLAN_SEC = 5.5 * 3600;
export const REPLAN_DELAY_SEC = 300;

/** Street priority weights (`assumed`, M3-11). */
export interface PriorityWeights {
  readonly backlog: number;
  readonly age: number;
  readonly risk: number;
}

const cal = getCalibration();
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { backlog: cal.priorityWeightBacklog.value, age: cal.priorityWeightAge.value, risk: cal.priorityWeightRisk.value };
