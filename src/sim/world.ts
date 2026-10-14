import type { RoutingPolicy, ScenarioSpec } from '../config/scenario';
import { daysFromCivil, parseCivil } from '../shared/civil';
import { improveWalk, orderBeat, partitionBeats, walkInOrder, type BeatWalk, type StreetSegment } from '../routing/beats';
import { shortestPath, straightLineHeuristic } from '../routing/dijkstra';
import { pointAlongEdge } from '../routing/geometry';
import { applyWeather, bucketOf, edgeSpeedMps, type SpeedModel } from '../routing/travel-time';
import { activationChance, blackSpotNext, type BlackSpotState } from './agents/black-spot';
import { compactorNext, type CompactorInput, type CompactorState } from './agents/compactor';
import { crewNext, type CrewState } from './agents/crew';
import { tipperNext, type TipperInput, type TipperState } from './agents/tipper';
import { DAY_SEC, dayIndex, secondOfDay, type SimTime } from './clock';
import type { PlanCause, SimEvent, SkipReason, StopTarget } from './events';
import { accumulatedKg, defaultProfiles, type DailyProfile } from './generation';
import type { BinSite, BlackSpotSite, MapData } from './map-data';
import { addVehicle, createTraffic, isIdle, removeVehicle, reroute, resume, setStopped, stepTraffic, vehiclePlace, type RouteStop, type Traffic, type TrafficEvent } from './movement/traffic';
import type { WeatherMode } from '../config/scenario';
import { keyedChance, keyedInt, keyedLogNormal, keyedRng, keyedUnit } from './conditions';
import { FillProfile, ForecastError, RateLearner, predictFullAt, segmentBacklogKg, type ObservedReading } from './forecast';
import { Lineage, type Batch } from './lineage';
import { createStreams, type Rng, type StreamName } from './rng';
import type { OperatorView, PlannerMap } from './observation';
import { mayDispatch, rankSpots } from './policies/crews';
import { dispatchCompactors, type TransferPointOutlook } from './policies/dispatch';
import { validatePlan } from './policies/dynamic';
import { DAILY_BUDGET, DAILY_CUTOFF_SEC, DAILY_PLAN_SEC, REPLAN_BUDGET, REPLAN_DELAY_SEC, type DayPlan, type Deferral, type PlannedStop, type PlanRequest, type PlanResult, type Planner } from './policies/types';
import { readSensor, type SensorParams, type SensorState } from './sensors';

export interface FleetConfig {
  readonly autoTippers: number;
  readonly compactors: number;
  readonly crews: number;
  readonly tipperPayloadKg: number;
  readonly compactorPayloadKg: number;
  /** Auto-tipper shift window, seconds of day (IST). */
  readonly tipperShift: readonly [start: number, end: number];
  /** Compactor shift window, seconds of day (IST). */
  readonly compactorShift: readonly [start: number, end: number];
}

export interface WorldConfig {
  readonly fleet: FleetConfig;
  readonly sensor: SensorParams;
  readonly speed: SpeedModel;
  /** Waste per household per day (kg), before weather and festival multipliers. */
  readonly householdKgPerDay: number;
  readonly kcdcIntakeCapKg: number;
  /** Chance per hourly check that a dormant black spot activates with no pressure on it. */
  readonly blackSpotBaseChancePerHour: number;
  /** For the ₹ fuel sub-line (M2-1). */
  readonly dieselPriceInrPerL: number;
  /** M3-D2: log-standard-deviation of the daily generation multiplier per segment and bin (`assumed`). Default 0. */
  readonly generationSigma?: number;
  /** M3-D2: share per day of backlog older than 48 h that leaves the system (`derived`, calibrated). Default 0. */
  readonly leakageSharePerDay?: number;
  /** M3-D2: backlog older than 48 h is dumped at the nearest black spot within this distance (m). Default 500. */
  readonly dumpRadiusM?: number;
}

/** M3-D9: how a Dynamic world gets its plans. Without a planner, requests wait for `providePlan` (the solver worker). */
export interface WorldOptions {
  readonly planner?: Planner;
}

/** Opaque world state. */
export interface World {
  readonly spec: ScenarioSpec;
}

export type VehicleKind = 'auto-tipper' | 'compactor' | 'crew';

export interface VehicleSummary {
  readonly id: number;
  readonly kind: VehicleKind;
  /** The state machine's current state kind, e.g. "OffShift". */
  readonly state: string;
}

/** Where every kilogram generated so far is (requirements L-1). The parts sum to generatedKg. */
export interface MassBalance {
  readonly generatedKg: number;
  /** Still on streets and in bins, including active black spots. */
  readonly uncollectedKg: number;
  readonly onVehiclesKg: number;
  readonly atTransferPointsKg: number;
  readonly deliveredKcdcKg: number;
  readonly deliveredLandfillKg: number;
  /** M3-D2: waste that left the system (informal collection, burning). */
  readonly leakedKg: number;
}

// Operating assumptions (`assumed`, kasaflow-assumptions).
const VEHICLE_LENGTH_M: Readonly<Record<VehicleKind, number>> = { 'auto-tipper': 4.5, compactor: 9, crew: 8 };
const SERVICE_SEC_PER_HOUSEHOLD = 10;
const MIN_SERVICE_SEC = 20;
const BIN_SERVICE_SEC = 60;
const TIP_SEC = 300;
const LOAD_SEC = 600;
const WEIGH_SEC = 120;
const UNLOAD_SEC = 600;
const TIPPER_STAGGER_SEC = 30;
const COMPACTOR_FIRST_SLOT_SEC = 9.5 * 3600;
const COMPACTOR_SLOT_EVERY_SEC = 2.5 * 3600;
const COMPACTOR_RUN_SEC = 2 * 3600;
const COMPACTOR_STAGGER_SEC = 600;
// Night clearance (X-2, M2-7): crews are dispatched 19:00–21:00 (`NIGHT_WINDOW` in policies/crews.ts).
const CLEAR_BASE_SEC = 600;
const CLEAR_SEC_PER_KG = 2;
const REPAIR_SEC: readonly [number, number] = [45 * 60, 120 * 60];
const SPOT_ACTIVATE_SHARE = 0.5;
const SPOT_HOURLY_SHARE = 0.25;
const SENSOR_PERIOD_SEC = 900;
/** Wet waste weighs ~15% more in a monsoon downpour, and wet is ~60% of the total (X-1). */
const MONSOON_FACTOR = 1 + 0.6 * 0.15;
/** M2-4: share of sensors that drop offline when a downpour starts, the heatwave overflow threshold and pressure. */
const MONSOON_SENSOR_OFFLINE = 0.03;
const OVERFLOW_PCT = 100;
const HEATWAVE_OVERFLOW_PCT = 90;
const HEATWAVE_PRESSURE = 1.5;
/** M2-9: beat speed used for the Routes table ETA (`assumed`). */
const ETA_BEAT_SPEED_MPS = 12 / 3.6;
const OPEN_END = Number.MAX_SAFE_INTEGER;

const MARKER_TAG = -1;
const binTag = (binId: number): number => -2 - binId;
const binOfTag = (tag: number): number => -2 - tag;

type TimerKind = 'shiftStart' | 'shiftEnd' | 'dwell' | 'tip' | 'load' | 'weigh' | 'unload' | 'offMapArrive' | 'offMapReturn' | 'breakdown' | 'repair' | 'clear' | 'earlyReturn';

// M3 operating assumptions (`assumed`, kasaflow-assumptions).
/** Backlog older than this is stale: it is dumped at a nearby black spot and part of it leaks (M3-D2). */
const STALE_SEC = 48 * 3600;
/** Share per hour of a stale segment's waste dumped at its nearest black spot. */
const DUMP_SHARE_PER_HOUR = 0.1;
const DEFAULT_DUMP_RADIUS_M = 500;
/** Compactor travel estimate for dispatch: straight line × 1.35 at 20 km/h. */
const COMPACTOR_DETOUR = 1.35;
const COMPACTOR_EST_MPS = 20 / 3.6;
/** Sensor history kept for the operator view (one day of 15-minute readings). */
const HISTORY_READINGS = 96;
/** Incident re-plans include the broken tipper and up to this many nearest tippers on shift. */
const REPLAN_NEIGHBOURS = 3;
interface Timer {
  at: SimTime;
  kind: TimerKind;
}

interface SegRt {
  readonly seg: StreetSegment;
  readonly dailyKg: number;
  lastServedAt: SimTime;
  accFrom: SimTime;
  carried: number;
  readonly skips: SimTime[];
}

interface BinRt {
  readonly site: BinSite;
  readonly profile: DailyProfile;
  accFrom: SimTime;
  carried: number;
  sensor: SensorState;
  /** Transfer point whose stock this container holds, or −1. */
  readonly tp: number;
  /** The last two non-null readings, for the predicted-full time (M2-9). */
  readonly recent: { t: SimTime; pct: number }[];
  lastServicedAt: SimTime | null;
  /** M3: the last day of readings as the operator sees them, and when the last one was taken. */
  readonly history: ObservedReading[];
  lastReadingAt: SimTime | null;
}

interface SpotRt {
  readonly site: BlackSpotSite;
  fsm: BlackSpotState;
  activatedAt: SimTime;
  assigned: boolean;
}

interface TpRt {
  readonly id: number;
  readonly node: number;
  stockKg: number;
  bay: number;
  readonly queue: number[];
  binId: number;
}

interface VehicleBase {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly payloadKg: number;
  loadKg: number;
  parkedNode: number;
  offMap: boolean;
  readonly timers: Timer[];
  /** Set while broken down: the timer that was pending (a dwell) and must restart after repair. */
  interrupted: TimerKind | null;
  /** Metres driven on earlier traffic entries (the traffic odometer restarts each time a vehicle re-enters). */
  odoBankM: number;
  /** Odometer reading at the start of today's shift. */
  shiftStartOdoM: number;
  servedToday: number;
  skippedToday: number;
  readonly servedSegs: Set<number>;
  readonly skippedSegs: Set<number>;
  readonly servedBins: Set<number>;
  /** Odometer at 00:00 today, for the fuel KPI (M2-1). */
  midnightOdoM: number;
  deviationsToday: number;
}

interface TipperRt extends VehicleBase {
  readonly kind: 'auto-tipper';
  fsm: TipperState;
  /** Today's walk: the static beat, or a Dynamic plan's route (M3-D6). */
  walk: BeatWalk | null;
  /** Bins this tipper empties, keyed by walk edge index. */
  binsAt: Map<number, number[]>;
  orderIndex: Map<number, number>;
  /** A plan replaced the walk during a service, stop or breakdown: re-route when it ends. */
  reroute: boolean;
  /** Index into walk.order of the next segment to serve today. */
  nextServe: number;
  /** The segment or bin tag whose service is in progress. */
  serving: number;
  shiftEnd: SimTime;
  /** The transfer point this beat hands over at (static plan). */
  readonly homeTp: number;
}

interface CompactorRt extends VehicleBase {
  readonly kind: 'compactor';
  fsm: CompactorState;
  /** The transfer point this compactor shuttles from (static plan). */
  readonly homeTp: number;
  run: number;
  day: number;
  tp: number;
  shiftEnd: SimTime;
}

interface CrewRt extends VehicleBase {
  readonly kind: 'crew';
  fsm: CrewState;
}

type VehicleRt = TipperRt | CompactorRt | CrewRt;

interface WorldState extends World {
  readonly map: MapData;
  readonly config: WorldConfig;
  readonly streams: Readonly<Record<StreamName, Rng>>;
  readonly traffic: Traffic;
  readonly household: DailyProfile;
  readonly segs: SegRt[];
  readonly bins: BinRt[];
  readonly spots: SpotRt[];
  readonly tps: TpRt[];
  readonly vehicles: VehicleRt[];
  readonly maxSpeedMps: number;
  t: SimTime;
  nextWake: SimTime;
  events: SimEvent[];
  delivered: { kcdc: number; landfill: number };
  kcdcIntakeByDay: Map<number, number>;
  /** M2: live weather, its speed model and generation multipliers (spans are closed when the weather changes). */
  weather: WeatherMode;
  speed: SpeedModel;
  readonly weatherSpans: { from: SimTime; to: SimTime; factor: number }[];
  closed: Set<number>;
  readonly lineage: Lineage;
  today: DayTotals;
  /** "vehicleId:day" → shift start (Routed) and arrival at the beat (Vehicle en route), for the tracker. */
  readonly routedAt: Map<string, SimTime>;
  readonly enRouteAt: Map<string, SimTime>;
  // M3 (architecture §10)
  policy: RoutingPolicy;
  readonly planner: Planner | null;
  readonly plannerMap: PlannerMap;
  readonly staticWalks: readonly (BeatWalk | null)[];
  readonly staticBins: readonly Map<number, number[]>[];
  /** Static beat owner (tipper id) of each segment, or −1. */
  readonly staticOwner: Int32Array;
  /** Plans requested and not yet applied, in request order. */
  readonly requests: { readonly req: PlanRequest; result: PlanResult | null }[];
  nextReqId: number;
  /** A switch to Static takes effect at this time. */
  pendingStatic: SimTime | null;
  readonly explain: TipperExplain[];
  readonly profiles: FillProfile[];
  readonly forecastError: ForecastError;
  readonly rHat: RateLearner;
  readonly weighedByDay: number[];
  readonly householdDaysByDay: number[];
  leaked: number;
  /** Nearest black spot within the dump radius of each segment, or −1 (M3-D2). */
  readonly dumpSpot: Int32Array;
  readonly spotSizeHourAgo: number[];
}

/** Today's explanation for one tipper (M3-10). */
interface TipperExplain {
  day: number;
  /** A Dynamic plan set today's route. */
  dynamic: boolean;
  planned: PlannedStop[];
  deferred: Deferral[];
  replans: { t: SimTime; cause: PlanCause; vehicleIds: readonly number[] }[];
}

/** Today's KPI accumulators (M2-1), reset at 00:00 IST. */
interface DayTotals {
  day: number;
  overflowHours: number;
  collectedKg: number;
  deliveredKg: number;
  readings: number;
  served: number;
  tips: number;
  unloads: number;
  /** Jobs scheduled today: key → window and when it was served. */
  readonly jobs: Map<string, { start: SimTime; end: SimTime; servedAt: SimTime | null }>;
}

function newDay(day: number): DayTotals {
  return { day, overflowHours: 0, collectedKg: 0, deliveredKg: 0, readings: 0, served: 0, tips: 0, unloads: 0, jobs: new Map() };
}

function markJob(w: WorldState, key: string): void {
  const job = w.today.jobs.get(key);
  if (job && job.servedAt === null) job.servedAt = w.t;
}

const ws = (w: World): WorldState => w as WorldState;

function emit(w: WorldState, e: SimEvent): void {
  w.events.push(e);
}

function setTimer(w: WorldState, v: VehicleRt, kind: TimerKind, at: SimTime): void {
  v.timers.push({ at, kind });
  if (at < w.nextWake) w.nextWake = at;
}

function clearTimer(v: VehicleRt, kind: TimerKind): void {
  const i = v.timers.findIndex((tm) => tm.kind === kind);
  if (i >= 0) v.timers.splice(i, 1);
}

// --- Waste stocks -------------------------------------------------------------------------------------------------

/**
 * Waste generated between two times (L-1, M2-4), with each day's lognormal multiplier per segment or bin (M3-D2).
 * `kind` 0 is a segment and 1 a bin.
 */
function genKg(w: WorldState, dailyKg: number, profile: DailyProfile, from: SimTime, to: SimTime, kind: 0 | 1, id: number): number {
  const sigma = w.config.generationSigma ?? 0;
  if (sigma <= 0 || to <= from) return accumulatedKg(dailyKg, profile, from, to, w.weatherSpans);
  let kg = 0;
  for (let d = dayIndex(from); d * DAY_SEC < to; d++) {
    const a = Math.max(from, d * DAY_SEC);
    const b = Math.min(to, (d + 1) * DAY_SEC);
    if (b > a) kg += accumulatedKg(dailyKg * keyedLogNormal(w.spec.seed, 'generation', sigma, kind, id, d), profile, a, b, w.weatherSpans);
  }
  return kg;
}

function segAmount(w: WorldState, s: SegRt, t: SimTime): number {
  return s.carried + genKg(w, s.dailyKg, w.household, s.accFrom, t, 0, s.seg.id);
}

function takeFromSeg(w: WorldState, s: SegRt, t: SimTime, maxKg: number): number {
  const amount = segAmount(w, s, t);
  const take = Math.min(amount, Math.max(0, maxKg));
  s.carried = amount - take;
  s.accFrom = t;
  return take;
}

function binAmount(w: WorldState, b: BinRt, t: SimTime): number {
  return b.carried + genKg(w, b.site.dailyKg, b.profile, b.accFrom, t, 1, b.site.id);
}

function takeFromBin(w: WorldState, b: BinRt, t: SimTime, maxKg: number): number {
  const amount = binAmount(w, b, t);
  const take = Math.min(amount, Math.max(0, maxKg));
  b.carried = amount - take;
  b.accFrom = t;
  return take;
}

function binFillPct(w: WorldState, b: BinRt, t: SimTime): number {
  const tpStock = b.tp >= 0 ? w.tps[b.tp]!.stockKg : 0;
  return ((binAmount(w, b, t) + tpStock) / b.site.capacityKg) * 100;
}

// --- Routing helpers ----------------------------------------------------------------------------------------------

function pathEdges(w: WorldState, from: number, to: number): number[] {
  if (from === to) return [];
  const g = w.map.graph;
  const bucket = bucketOf(secondOfDay(w.t));
  const open = (e: number): number => g.edgeLengthM[e]! / edgeSpeedMps(g, e, bucket, w.speed);
  const h = straightLineHeuristic(g, to, w.maxSpeedMps);
  // Closed (flooded) edges cost Infinity; if a place can only be reached through water, drive through it.
  const path =
    (w.closed.size > 0 ? shortestPath(g, from, to, (e) => (w.closed.has(e) ? Number.POSITIVE_INFINITY : open(e)), h) : null) ?? shortestPath(g, from, to, open, h);
  if (!path) throw new Error(`No route from node ${from} to node ${to}`);
  return [...path.edges];
}

/** Where a vehicle is now: its current edge if driving, else the node it is parked at or waiting to leave from. */
function locate(w: WorldState, v: VehicleRt): { edge: number } | { node: number } {
  const place = vehiclePlace(w.traffic, v.id);
  if (place?.status === 'active') return { edge: place.edge };
  return { node: v.parkedNode };
}

/**
 * Sends a vehicle along `tail` (edges after its current edge, or from its parked node), with stops numbered from the
 * start of `tail`. Returns false if there is nowhere to drive (already there).
 */
function odometerM(w: WorldState, v: VehicleRt): number {
  return v.odoBankM + (vehiclePlace(w.traffic, v.id)?.odometerM ?? 0);
}

/** Takes a vehicle off the road network, keeping its odometer. */
function takeOffRoad(w: WorldState, v: VehicleRt): void {
  v.odoBankM = odometerM(w, v);
  removeVehicle(w.traffic, v.id);
}

function drive(w: WorldState, v: VehicleRt, toNode: number, after: readonly number[] = [], stops: readonly RouteStop[] = [], departAt: SimTime = w.t): boolean {
  const g = w.map.graph;
  const loc = locate(w, v);
  if ('edge' in loc) {
    const head = pathEdges(w, g.edgeTo[loc.edge]!, toNode);
    const route = [loc.edge, ...head, ...after];
    reroute(w.traffic, v.id, route, stops.map((s) => ({ ...s, routeIdx: s.routeIdx + 1 + head.length })));
    return true;
  }
  const head = pathEdges(w, loc.node, toNode);
  const route = [...head, ...after];
  if (route.length === 0) return false;
  takeOffRoad(w, v);
  addVehicle(w.traffic, { id: v.id, lengthM: VEHICLE_LENGTH_M[v.kind], route, departAt }, stops.map((s) => ({ ...s, routeIdx: s.routeIdx + head.length })));
  return true;
}

function currentNode(w: WorldState, v: VehicleRt): number {
  const loc = locate(w, v);
  return 'edge' in loc ? w.map.graph.edgeTo[loc.edge]! : loc.node;
}

// --- Auto-tippers -------------------------------------------------------------------------------------------------

function tipperTo(v: TipperRt, input: TipperInput): void {
  v.fsm = tipperNext(v.fsm, input);
}

const segClosed = (w: WorldState, segId: number): boolean => w.segs[segId]!.seg.edges.some((e) => w.closed.has(e));

/**
 * With flooded streets (M2-5): skip the closed segments still ahead (reason road-closed), and drive to each remaining
 * one, reusing the original walk between consecutive services where it is dry and re-planning around the water
 * elsewhere. Bins are served where the new route passes them.
 */
function sendAlongBeatAroundClosures(w: WorldState, v: TipperRt): void {
  const walk = v.walk!;
  const g = w.map.graph;
  const loc = locate(w, v);
  const startNode = 'edge' in loc ? g.edgeTo[loc.edge]! : loc.node;
  const edges: number[] = [];
  const stops: RouteStop[] = [];
  let cursor = startNode;
  let prevService = -1;
  let first = true;
  for (let i = v.nextServe; i < walk.order.length; i++) {
    const segId = walk.order[i]!;
    if (segClosed(w, segId)) {
      if (!v.skippedSegs.has(segId)) {
        w.segs[segId]!.skips.push(w.t);
        v.skippedToday++;
        v.skippedSegs.add(segId);
        emit(w, { t: w.t, kind: 'StopSkipped', vehicleId: v.id, target: { type: 'segment', id: segId }, reason: 'road-closed' });
      }
      continue;
    }
    const k = walk.serviceEdgeIndex[i]!;
    const serviceEdge = walk.edges[k]!;
    const between = prevService >= 0 ? walk.edges.slice(walk.serviceEdgeIndex[prevService]! + 1, k) : null;
    const reusable = between !== null && prevService === i - 1 && between.every((e) => !w.closed.has(e)) && (between.length === 0 ? cursor === g.edgeFrom[serviceEdge] : g.edgeFrom[between[0]!] === cursor);
    edges.push(...(reusable ? between : pathEdges(w, cursor, g.edgeFrom[serviceEdge]!)));
    if (first && v.fsm.kind === 'ToBeat') stops.push({ routeIdx: edges.length, s: 0, tag: MARKER_TAG });
    first = false;
    stops.push({ routeIdx: edges.length, s: g.edgeLengthM[serviceEdge]! / 2, tag: segId });
    edges.push(serviceEdge);
    cursor = g.edgeTo[serviceEdge]!;
    prevService = i;
  }
  const pendingBins = new Set([...v.binsAt.values()].flat().filter((b) => !v.servedBins.has(b)));
  edges.forEach((e, r) => {
    for (const b of pendingBins) {
      if (g.edgeTo[e] !== w.map.bins[b]!.node) continue;
      stops.push({ routeIdx: r, s: Math.max(0, g.edgeLengthM[e]! - 0.01), tag: binTag(b) });
      pendingBins.delete(b);
    }
  });
  v.nextServe = walk.order.length;
  for (let i = walk.order.length - 1; i >= 0; i--) if (!segClosed(w, walk.order[i]!) && !v.servedSegs.has(walk.order[i]!) && !v.skippedSegs.has(walk.order[i]!)) v.nextServe = i;
  if (edges.length === 0) {
    // Everything left is under water: the beat is over.
    if (v.fsm.kind === 'ToBeat') tipperTo(v, { kind: 'ArrivedAtBeat' });
    if (v.fsm.kind === 'Driving') {
      tipperTo(v, { kind: 'BeatDone' });
      sendToTip(w, v);
    }
    return;
  }
  drive(w, v, startNode, edges, stops);
}

/** Drives to the next unserved segment of the beat and on along the rest of the walk, with service and bin stops. */
function sendAlongBeat(w: WorldState, v: TipperRt): void {
  v.reroute = false;
  if (w.closed.size > 0) {
    sendAlongBeatAroundClosures(w, v);
    return;
  }
  const walk = v.walk!;
  const g = w.map.graph;
  const k0 = walk.serviceEdgeIndex[v.nextServe]!;
  const rest = walk.edges.slice(k0);
  // The arrival marker only while heading to the beat (a re-plan can re-send a tipper already on it).
  const stops: RouteStop[] = v.fsm.kind === 'ToBeat' ? [{ routeIdx: 0, s: 0, tag: MARKER_TAG }] : [];
  for (let i = v.nextServe; i < walk.order.length; i++) {
    const k = walk.serviceEdgeIndex[i]! - k0;
    stops.push({ routeIdx: k, s: g.edgeLengthM[rest[k]!]! / 2, tag: walk.order[i]! });
  }
  for (const [k, binIds] of v.binsAt) {
    if (k < k0) continue;
    for (const b of binIds) stops.push({ routeIdx: k - k0, s: Math.max(0, g.edgeLengthM[walk.edges[k]!]! - 0.01), tag: binTag(b) });
  }
  // The marker sits at the start of the first beat edge, so it fires as the tipper arrives at its beat.
  const start = g.edgeFrom[rest[0]!]!;
  drive(w, v, start, rest, stops);
}

function skipRemaining(w: WorldState, v: TipperRt, reason: SkipReason): void {
  if (!v.walk) return;
  for (let i = v.nextServe; i < v.walk.order.length; i++) {
    const segId = v.walk.order[i]!;
    if (v.skippedSegs.has(segId)) continue;
    w.segs[segId]!.skips.push(w.t);
    v.skippedToday++;
    v.skippedSegs.add(segId);
    emit(w, { t: w.t, kind: 'StopSkipped', vehicleId: v.id, target: { type: 'segment', id: segId }, reason });
  }
  v.nextServe = v.walk.order.length;
}

/** Carries on with what is left of today's walk, or, with nothing left, ends the beat (M3: after a re-plan). */
function continueBeat(w: WorldState, v: TipperRt): void {
  if (v.fsm.kind !== 'ToBeat' && v.fsm.kind !== 'Driving') return;
  if (v.walk && v.nextServe < v.walk.order.length) {
    sendAlongBeat(w, v);
    return;
  }
  v.reroute = false;
  if (v.fsm.kind === 'ToBeat') tipperTo(v, { kind: 'ArrivedAtBeat' });
  tipperTo(v, { kind: 'BeatDone' });
  sendToTip(w, v);
}

/** After a stop: resume the traffic route, or re-route if a plan replaced the walk meanwhile. */
function resumeOrReroute(w: WorldState, v: TipperRt): void {
  if (v.reroute) continueBeat(w, v);
  else resume(w.traffic, v.id);
}

/** Moves the walk position past a served or skipped segment (if it is on today's walk). */
function advancePast(v: TipperRt, segId: number): void {
  const idx = v.orderIndex.get(segId);
  if (idx !== undefined) v.nextServe = idx + 1;
}

function sendToTip(w: WorldState, v: TipperRt): void {
  if (!drive(w, v, w.tps[v.homeTp]!.node)) arriveAtTransfer(w, v);
}

function sendHome(w: WorldState, v: VehicleRt): void {
  if (!drive(w, v, w.map.facilities.depotNode)) arriveHome(w, v);
}

function arriveAtTransfer(w: WorldState, v: TipperRt): void {
  tipperTo(v, { kind: 'ArrivedAtTransfer' });
  v.parkedNode = currentNode(w, v);
  setTimer(w, v, 'tip', w.t + TIP_SEC);
}

function resetDay(w: WorldState, v: VehicleRt): void {
  v.shiftStartOdoM = odometerM(w, v);
  v.servedToday = 0;
  v.skippedToday = 0;
  v.servedSegs.clear();
  v.skippedSegs.clear();
  v.servedBins.clear();
  v.deviationsToday = 0;
}

function startTipperShift(w: WorldState, v: TipperRt): void {
  resetDay(w, v);
  const day = dayIndex(w.t);
  const absent = absentOn(w, v.id, day);
  v.shiftEnd = day * DAY_SEC + w.config.fleet.tipperShift[1];
  setTimer(w, v, 'shiftEnd', v.shiftEnd);
  v.nextServe = 0;
  w.routedAt.set(`${v.id}:${day}`, w.t);
  for (const segId of v.walk?.order ?? []) w.today.jobs.set(`seg:${segId}`, { start: w.t, end: v.shiftEnd, servedAt: null });
  for (const binId of [...v.binsAt.values()].flat()) w.today.jobs.set(`bin:${binId}`, { start: w.t, end: v.shiftEnd, servedAt: null });
  tipperTo(v, { kind: 'ShiftStart', absent });
  if (absent) {
    emit(w, { t: w.t, kind: 'VehicleAbsent', vehicleId: v.id });
    skipRemaining(w, v, 'absent');
    return;
  }
  emit(w, { t: w.t, kind: 'ShiftStarted', vehicleId: v.id });
  scheduleBreakdown(w, v, w.t, v.shiftEnd);
  // M3-D2: a non-compliant early return, at a uniform time in the second half of the shift.
  if (keyedChance(w.spec.seed, 'earlyReturn', w.spec.levers.earlyReturnChance ?? 0, v.id, day)) {
    const half = (v.shiftEnd - w.t) / 2;
    setTimer(w, v, 'earlyReturn', Math.floor(w.t + half + half * keyedUnit(w.spec.seed, 'earlyReturn', v.id, day, 1)));
  }
  if (!v.walk || v.walk.order.length === 0) {
    tipperTo(v, { kind: 'ShiftEnd', loadKg: v.loadKg });
    sendHome(w, v);
    return;
  }
  sendAlongBeat(w, v);
}

function tipperStop(w: WorldState, v: TipperRt, tag: number): void {
  if (tag === MARKER_TAG) {
    tipperTo(v, { kind: 'ArrivedAtBeat' });
    const key = `${v.id}:${dayIndex(w.t)}`;
    if (!w.enRouteAt.has(key)) w.enRouteAt.set(key, w.t);
    resumeOrReroute(w, v);
    return;
  }
  if (tag >= 0) {
    tipperTo(v, { kind: 'ReachedSegment', segmentId: tag });
    if (keyedChance(w.spec.seed, 'skip', w.spec.levers.skipChance, tag, dayIndex(w.t))) {
      w.segs[tag]!.skips.push(w.t);
      v.skippedToday++;
      v.skippedSegs.add(tag);
      emit(w, { t: w.t, kind: 'StopSkipped', vehicleId: v.id, target: { type: 'segment', id: tag }, reason: 'non-compliance' });
      advancePast(v, tag);
      tipperTo(v, { kind: 'SegmentDone' });
      resumeOrReroute(w, v);
      return;
    }
    v.serving = tag;
    setTimer(w, v, 'dwell', w.t + Math.max(MIN_SERVICE_SEC, SERVICE_SEC_PER_HOUSEHOLD * w.segs[tag]!.seg.households));
    return;
  }
  v.serving = tag;
  setTimer(w, v, 'dwell', w.t + BIN_SERVICE_SEC);
}

function finishService(w: WorldState, v: TipperRt): void {
  const tag = v.serving;
  const room = v.payloadKg - v.loadKg;
  let kg: number;
  let left: number;
  let target: StopTarget;
  if (tag >= 0) {
    const s = w.segs[tag]!;
    kg = takeFromSeg(w, s, w.t, room);
    left = segAmount(w, s, w.t);
    addHouseholdDays(w, (s.seg.households * (w.t - s.lastServedAt)) / DAY_SEC);
    s.lastServedAt = w.t;
    target = { type: 'segment', id: tag };
  } else {
    const b = w.bins[binOfTag(tag)]!;
    kg = takeFromBin(w, b, w.t, room);
    left = binAmount(w, b, w.t);
    target = { type: 'bin', id: b.site.id };
  }
  v.loadKg += kg;
  v.servedToday++;
  if (tag >= 0) v.servedSegs.add(tag);
  else {
    v.servedBins.add(target.id);
    w.bins[target.id]!.lastServicedAt = w.t;
  }
  if (kg > 0) w.lineage.collect(target, kg, w.t, v.id);
  w.today.collectedKg += kg;
  w.today.served++;
  markJob(w, `${target.type === 'segment' ? 'seg' : 'bin'}:${target.id}`);
  emit(w, { t: w.t, kind: 'StopServed', vehicleId: v.id, target, kg });
  if (left > 1e-9) {
    // Full before the stop was cleared: tip and come back to it.
    if (tag >= 0) {
      const idx = v.orderIndex.get(tag);
      if (idx !== undefined) v.nextServe = idx;
    }
    tipperTo(v, { kind: 'PayloadFull' });
    sendToTip(w, v);
    return;
  }
  if (tag >= 0) {
    advancePast(v, tag);
    tipperTo(v, { kind: 'SegmentDone' });
  }
  resumeOrReroute(w, v);
}

function tipperArrived(w: WorldState, v: TipperRt): void {
  switch (v.fsm.kind) {
    case 'Driving':
      tipperTo(v, { kind: 'BeatDone' });
      sendToTip(w, v);
      return;
    case 'ToTransfer':
      arriveAtTransfer(w, v);
      return;
    case 'ToDepot':
      arriveHome(w, v);
      return;
    default:
      return;
  }
}

function finishTip(w: WorldState, v: TipperRt): void {
  const tp = w.tps[v.homeTp]!;
  emit(w, { t: w.t, kind: 'Tipped', vehicleId: v.id, transferPointId: tp.id, kg: v.loadKg });
  w.lineage.tip(v.id, tp.id, w.t);
  w.today.tips++;
  tp.stockKg += v.loadKg;
  v.loadKg = 0;
  const beatRemaining = v.walk !== null && v.nextServe < v.walk.order.length && w.t < v.shiftEnd;
  tipperTo(v, { kind: 'TipDone', beatRemaining });
  if (beatRemaining) sendAlongBeat(w, v);
  else sendHome(w, v);
}

function tipperShiftEnd(w: WorldState, v: TipperRt, reason: SkipReason = 'shift-ended'): void {
  switch (v.fsm.kind) {
    case 'Absent':
      tipperTo(v, { kind: 'ShiftEnd', loadKg: v.loadKg });
      scheduleNextShift(w, v);
      return;
    case 'BrokenDown':
      skipRemaining(w, v, 'breakdown');
      tow(w, v);
      tipperTo(v, { kind: 'ShiftEnd', loadKg: v.loadKg });
      scheduleNextShift(w, v);
      return;
    case 'ToBeat':
    case 'Driving':
    case 'Serving':
    case 'Deviating':
      clearTimer(v, 'dwell');
      skipRemaining(w, v, reason);
      // ShiftEnd sends a loaded tipper to tip first, an empty one straight home.
      tipperTo(v, { kind: 'ShiftEnd', loadKg: v.loadKg });
      if (v.loadKg > 0) sendToTip(w, v);
      else sendHome(w, v);
      return;
    default:
      return;
  }
}

// --- Shared vehicle lifecycle -------------------------------------------------------------------------------------

function arriveHome(w: WorldState, v: VehicleRt): void {
  v.parkedNode = w.map.facilities.depotNode;
  if (v.kind === 'auto-tipper') tipperTo(v, { kind: 'ArrivedAtDepot' });
  else if (v.kind === 'compactor') v.fsm = compactorNext(v.fsm, { kind: 'ArrivedAtDepot' });
  emit(w, { t: w.t, kind: 'ShiftEnded', vehicleId: v.id });
  scheduleNextShift(w, v);
}

function tow(w: WorldState, v: VehicleRt): void {
  takeOffRoad(w, v);
  v.parkedNode = w.map.facilities.depotNode;
  v.timers.length = 0;
  v.interrupted = null;
}

function scheduleNextShift(w: WorldState, v: VehicleRt): void {
  v.timers.length = 0;
  const start = v.kind === 'auto-tipper' ? w.config.fleet.tipperShift[0] + v.id * TIPPER_STAGGER_SEC : w.config.fleet.compactorShift[0];
  let day = dayIndex(w.t);
  if (day * DAY_SEC + start <= w.t) day++;
  setTimer(w, v, 'shiftStart', day * DAY_SEC + start);
}

function scheduleBreakdown(w: WorldState, v: VehicleRt, from: SimTime, to: SimTime): void {
  const day = dayIndex(from);
  if (to > from && keyedChance(w.spec.seed, 'breakdown', w.spec.levers.breakdownChancePerShift, v.id, day)) setTimer(w, v, 'breakdown', keyedInt(w.spec.seed, 'breakdown', from, to - 1, v.id, day, 1));
}

const MOVING = new Set(['ToBeat', 'Driving', 'Serving', 'ToTransfer', 'ToDepot', 'ToTransferPoint', 'ToKCDC', 'ToLandfill']);

function breakDown(w: WorldState, v: VehicleRt): void {
  if (v.kind === 'crew' || v.offMap || !MOVING.has(v.fsm.kind)) return;
  if (v.timers.some((tm) => tm.kind === 'dwell')) {
    clearTimer(v, 'dwell');
    v.interrupted = 'dwell';
  }
  if (v.kind === 'auto-tipper') tipperTo(v, { kind: 'Breakdown' });
  else v.fsm = compactorNext(v.fsm, { kind: 'Breakdown' });
  if (vehiclePlace(w.traffic, v.id)) setStopped(w.traffic, v.id, true);
  emit(w, { t: w.t, kind: 'BrokenDown', vehicleId: v.id });
  setTimer(w, v, 'repair', w.t + keyedInt(w.spec.seed, 'repair', REPAIR_SEC[0], REPAIR_SEC[1], v.id, w.t));
  // M3-D9: under Dynamic a tipper breakdown re-plans its streets among the nearest tippers on shift.
  if (v.kind === 'auto-tipper' && w.policy === 'dynamic') requestPlan(w, 'breakdown', [v.id, ...nearestOnShift(w, v, REPLAN_NEIGHBOURS)]);
}

function repair(w: WorldState, v: VehicleRt): void {
  if (v.fsm.kind !== 'BrokenDown') return;
  if (v.kind === 'auto-tipper') tipperTo(v, { kind: 'Repaired' });
  else if (v.kind === 'compactor') v.fsm = compactorNext(v.fsm, { kind: 'Repaired' });
  if (vehiclePlace(w.traffic, v.id)) setStopped(w.traffic, v.id, false);
  emit(w, { t: w.t, kind: 'Repaired', vehicleId: v.id });
  if (v.interrupted === 'dwell' && v.kind === 'auto-tipper') {
    v.interrupted = null;
    // Restart the interrupted service.
    if (v.serving >= 0) tipperTo(v, { kind: 'ReachedSegment', segmentId: v.serving });
    setTimer(w, v, 'dwell', w.t + (v.serving >= 0 ? Math.max(MIN_SERVICE_SEC, SERVICE_SEC_PER_HOUSEHOLD * w.segs[v.serving]!.seg.households) : BIN_SERVICE_SEC));
  } else if (v.kind === 'auto-tipper' && v.reroute) {
    continueBeat(w, v);
  }
}

// --- Compactors ---------------------------------------------------------------------------------------------------

function compactorTo(v: CompactorRt, input: CompactorInput): void {
  v.fsm = compactorNext(v.fsm, input);
}

function slot(v: CompactorRt, run: number): SimTime {
  return v.day * DAY_SEC + COMPACTOR_FIRST_SLOT_SEC + run * COMPACTOR_SLOT_EVERY_SEC + (v.id % 6) * COMPACTOR_STAGGER_SEC;
}

function sendToNextTp(w: WorldState, v: CompactorRt): void {
  v.tp = v.homeTp;
  const tp = w.tps[v.tp]!;
  if (!drive(w, v, tp.node, [], [], Math.max(w.t, slot(v, v.run)))) arriveAtTp(w, v);
}

function startCompactorShift(w: WorldState, v: CompactorRt): void {
  resetDay(w, v);
  v.day = dayIndex(w.t);
  v.run = 0;
  v.shiftEnd = v.day * DAY_SEC + w.config.fleet.compactorShift[1];
  w.routedAt.set(`${v.id}:${v.day}`, w.t);
  // M3-D7: under Dynamic the compactor waits at the depot for the dispatcher.
  const wait = w.policy === 'dynamic';
  compactorTo(v, { kind: 'ShiftStart', wait });
  emit(w, { t: w.t, kind: 'ShiftStarted', vehicleId: v.id });
  scheduleBreakdown(w, v, w.t, v.shiftEnd);
  if (wait) {
    setTimer(w, v, 'shiftEnd', v.shiftEnd);
    dispatchRound(w);
  } else {
    sendToNextTp(w, v);
  }
}

function arriveAtTp(w: WorldState, v: CompactorRt): void {
  v.parkedNode = w.tps[v.tp]!.node;
  compactorTo(v, { kind: 'ArrivedAtTransferPoint' });
  w.tps[v.tp]!.queue.push(v.id);
  serveBay(w, w.tps[v.tp]!);
}

function serveBay(w: WorldState, tp: TpRt): void {
  if (tp.bay >= 0 || tp.queue.length === 0) return;
  const v = w.vehicles[tp.queue.shift()!] as CompactorRt;
  tp.bay = v.id;
  compactorTo(v, { kind: 'BayFree' });
  setTimer(w, v, 'load', w.t + LOAD_SEC);
}

function finishLoading(w: WorldState, v: CompactorRt): void {
  const tp = w.tps[v.tp]!;
  const room = v.payloadKg - v.loadKg;
  const fromStock = Math.min(tp.stockKg, room);
  tp.stockKg -= fromStock;
  let fromBin = 0;
  if (tp.binId >= 0) fromBin = takeFromBin(w, w.bins[tp.binId]!, w.t, room - fromStock);
  v.loadKg += fromStock + fromBin;
  w.lineage.load(tp.id, fromStock, w.t, v.id);
  if (fromBin > 0) w.lineage.collect({ type: 'bin', id: tp.binId }, fromBin, w.t, v.id);
  w.today.collectedKg += fromBin;
  if (tp.binId >= 0) {
    w.bins[tp.binId]!.lastServicedAt = w.t;
    w.today.served++;
    emit(w, { t: w.t, kind: 'StopServed', vehicleId: v.id, target: { type: 'bin', id: tp.binId }, kg: fromStock + fromBin });
  }
  compactorTo(v, { kind: 'Depart' });
  tp.bay = -1;
  serveBay(w, tp);
  if (!drive(w, v, w.map.facilities.kcdcNode)) arriveAtKcdc(w, v);
}

function arriveAtKcdc(w: WorldState, v: CompactorRt): void {
  v.parkedNode = w.map.facilities.kcdcNode;
  compactorTo(v, { kind: 'ArrivedAtKCDC' });
  setTimer(w, v, 'weigh', w.t + WEIGH_SEC);
}

function finishWeighing(w: WorldState, v: CompactorRt): void {
  emit(w, { t: w.t, kind: 'Weighed', vehicleId: v.id, kg: v.loadKg });
  const day = dayIndex(w.t);
  const intake = w.kcdcIntakeByDay.get(day) ?? 0;
  const diverted = v.loadKg > 0 && intake + v.loadKg > w.config.kcdcIntakeCapKg;
  compactorTo(v, { kind: 'Weighed', diverted });
  if (!diverted) {
    setTimer(w, v, 'unload', w.t + UNLOAD_SEC);
    return;
  }
  emit(w, { t: w.t, kind: 'Diverted', vehicleId: v.id, kg: v.loadKg });
  if (!drive(w, v, w.map.facilities.landfill.exitNode)) leaveForLandfill(w, v);
}

function leaveForLandfill(w: WorldState, v: VehicleRt): void {
  v.parkedNode = w.map.facilities.landfill.exitNode;
  takeOffRoad(w, v);
  v.offMap = true;
  setTimer(w, v, 'offMapArrive', w.t + w.map.facilities.landfill.offMapTravelSec);
}

function finishUnloading(w: WorldState, v: CompactorRt | CrewRt, site: 'KCDC' | 'Landfill'): void {
  emit(w, { t: w.t, kind: 'Unloaded', vehicleId: v.id, site, kg: v.loadKg });
  w.lineage.unload(v.id, site, w.t);
  w.today.deliveredKg += v.loadKg;
  w.today.unloads++;
  const weighDay = dayIndex(w.t);
  while (w.weighedByDay.length <= weighDay) w.weighedByDay.push(0);
  w.weighedByDay[weighDay]! += v.loadKg;
  if (site === 'KCDC') {
    const day = dayIndex(w.t);
    w.kcdcIntakeByDay.set(day, (w.kcdcIntakeByDay.get(day) ?? 0) + v.loadKg);
    w.delivered.kcdc += v.loadKg;
  } else {
    w.delivered.landfill += v.loadKg;
  }
  v.loadKg = 0;
  if (v.kind === 'crew') {
    v.fsm = crewNext(v.fsm, { kind: 'Unloaded' });
    if (site === 'Landfill') setTimer(w, v, 'offMapReturn', w.t + w.map.facilities.landfill.offMapTravelSec);
    return;
  }
  if (site === 'Landfill') {
    setTimer(w, v, 'offMapReturn', w.t + w.map.facilities.landfill.offMapTravelSec);
    return;
  }
  continueCompactor(w, v);
}

function continueCompactor(w: WorldState, v: CompactorRt): void {
  if (w.policy === 'dynamic') {
    const more = w.t + COMPACTOR_RUN_SEC <= v.shiftEnd;
    compactorTo(v, { kind: 'UnloadDone', moreRuns: more, wait: true });
    if (!more) {
      sendHome(w, v);
      return;
    }
    if (!v.timers.some((tm) => tm.kind === 'shiftEnd')) setTimer(w, v, 'shiftEnd', v.shiftEnd);
    dispatchRound(w);
    return;
  }
  const moreRuns = slot(v, v.run + 1) + COMPACTOR_RUN_SEC <= v.shiftEnd;
  compactorTo(v, { kind: 'UnloadDone', moreRuns });
  if (moreRuns) {
    v.run++;
    sendToNextTp(w, v);
  } else {
    sendHome(w, v);
  }
}

function compactorArrived(w: WorldState, v: CompactorRt): void {
  switch (v.fsm.kind) {
    case 'ToTransferPoint':
      arriveAtTp(w, v);
      return;
    case 'ToKCDC':
      arriveAtKcdc(w, v);
      return;
    case 'ToLandfill':
      leaveForLandfill(w, v);
      return;
    case 'ToDepot':
      arriveHome(w, v);
      return;
    default:
      return;
  }
}

// --- Clearance crews and black spots ------------------------------------------------------------------------------

function crewArrived(w: WorldState, v: CrewRt): void {
  if (v.fsm.kind === 'ToBlackSpot') {
    const spot = w.spots[v.fsm.blackSpotId]!;
    v.parkedNode = spot.site.node;
    v.fsm = crewNext(v.fsm, { kind: 'Arrived' });
    spot.fsm = blackSpotNext(spot.fsm, { kind: 'CrewArrived' });
    const size = spot.fsm.kind === 'Clearing' ? spot.fsm.sizeKg : 0;
    setTimer(w, v, 'clear', w.t + CLEAR_BASE_SEC + CLEAR_SEC_PER_KG * size);
    return;
  }
  if (v.fsm.kind === 'ToDisposal') leaveForLandfill(w, v);
}

function finishClearing(w: WorldState, v: CrewRt): void {
  if (v.fsm.kind !== 'Clearing') return;
  const spot = w.spots[v.fsm.blackSpotId]!;
  const size = spot.fsm.kind === 'Clearing' ? spot.fsm.sizeKg : 0;
  v.loadKg += size;
  spot.fsm = blackSpotNext(spot.fsm, { kind: 'Cleared' });
  spot.assigned = false;
  markJob(w, `spot:${spot.site.id}:${spot.activatedAt}`);
  emit(w, { t: w.t, kind: 'BlackSpotCleared', blackSpotId: spot.site.id, kg: size });
  v.fsm = crewNext(v.fsm, { kind: 'ClearingDone' });
  if (!drive(w, v, w.map.facilities.landfill.exitNode)) leaveForLandfill(w, v);
}

/** Moves a share of the spot's streets' uncollected waste onto the spot (residents dump where collection fails). */
function dumpOntoSpot(w: WorldState, spot: SpotRt, share: number): number {
  let moved = 0;
  for (const id of spot.site.segmentIds) {
    const s = w.segs[id]!;
    moved += takeFromSeg(w, s, w.t, segAmount(w, s, w.t) * share);
  }
  return moved;
}

function activateSpot(w: WorldState, spot: SpotRt, initialKg: number): void {
  spot.fsm = blackSpotNext(spot.fsm, { kind: 'Activate', initialKg });
  spot.activatedAt = w.t;
  w.today.jobs.set(`spot:${spot.site.id}:${w.t}`, { start: w.t, end: w.t + DAY_SEC, servedAt: null });
  emit(w, { t: w.t, kind: 'BlackSpotActivated', blackSpotId: spot.site.id });
}

/** M3-D2: a share of stale backlog (over 48 h) is dumped at the nearest black spot within the dump radius. */
function dumpStaleBacklog(w: WorldState): void {
  for (const s of w.segs) {
    const spotId = w.dumpSpot[s.seg.id]!;
    if (spotId < 0 || w.t - s.lastServedAt <= STALE_SEC) continue;
    const spot = w.spots[spotId]!;
    if (spot.fsm.kind === 'Clearing') continue;
    const kg = takeFromSeg(w, s, w.t, segAmount(w, s, w.t) * DUMP_SHARE_PER_HOUR);
    if (kg <= 0) continue;
    if (spot.fsm.kind === 'Dormant') activateSpot(w, spot, kg);
    else spot.fsm = blackSpotNext(spot.fsm, { kind: 'Grow', kg });
  }
}

function hourlyBlackSpots(w: WorldState): void {
  dumpStaleBacklog(w);
  for (const spot of w.spots) {
    if (spot.fsm.kind === 'Active') {
      spot.fsm = blackSpotNext(spot.fsm, { kind: 'Grow', kg: dumpOntoSpot(w, spot, SPOT_HOURLY_SHARE) });
      continue;
    }
    if (spot.fsm.kind !== 'Dormant') continue;
    let backlog = 0;
    let skips = 0;
    for (const id of spot.site.segmentIds) {
      const s = w.segs[id]!;
      backlog = Math.max(backlog, (w.t - s.lastServedAt) / 3600);
      skips += s.skips.filter((at) => at > w.t - DAY_SEC).length;
    }
    const k = w.weather === 'heatwave' ? HEATWAVE_PRESSURE : 1;
    const p = activationChance({ backlogHours: backlog * k, skipsLast24h: skips * k, baseChancePerHour: w.config.blackSpotBaseChancePerHour });
    if (!keyedChance(w.spec.seed, 'blackspots', p, spot.site.id, Math.floor(w.t / 3600))) continue;
    activateSpot(w, spot, dumpOntoSpot(w, spot, SPOT_ACTIVATE_SHARE));
  }
  dispatchCrews(w);
  for (const spot of w.spots) w.spotSizeHourAgo[spot.site.id] = spot.fsm.kind === 'Dormant' ? 0 : spot.fsm.sizeKg;
}

/**
 * Crews (L-2): Static clears in activation order inside the night window (M2-7); Dynamic clears by risk, and a spot at
 * or above the critical size may be cleared in daytime (M3-D8). Risk uses only what the operator knows: the spot's
 * sensor size, its growth over the last hour, and the estimated backlog on its streets.
 */
function dispatchCrews(w: WorldState): void {
  const sod = secondOfDay(w.t);
  const open = w.spots.filter((s) => s.fsm.kind === 'Active' && !s.assigned);
  if (open.length === 0) return;
  const size = (s: SpotRt): number => (s.fsm.kind === 'Dormant' ? 0 : s.fsm.sizeKg);
  let ordered: SpotRt[];
  if (w.policy === 'dynamic') {
    const outlook = open.map((s) => ({
      id: s.site.id,
      sizeKg: size(s),
      growthKgPerHour: Math.max(0, size(s) - (w.spotSizeHourAgo[s.site.id] ?? 0)),
      nearbyBacklogKg: s.site.segmentIds.reduce((a, id) => a + segmentBacklogKg(w.segs[id]!.seg.households, w.rHat.value(), w.segs[id]!.lastServedAt, w.t, w.household), 0),
    }));
    ordered = rankSpots(outlook, w.weather === 'heatwave').map((o) => w.spots[o.id]!);
  } else {
    ordered = [...open].sort((a, b) => a.activatedAt - b.activatedAt || a.site.id - b.site.id);
  }
  for (const v of w.vehicles) {
    if (v.kind !== 'crew' || v.fsm.kind !== 'Idle' || v.offMap || v.timers.length > 0) continue;
    const spot = ordered.find((s) => !s.assigned && mayDispatch(sod, size(s), w.policy));
    if (!spot) break;
    spot.assigned = true;
    v.fsm = crewNext(v.fsm, { kind: 'Dispatch', blackSpotId: spot.site.id });
    if (!drive(w, v, spot.site.node)) crewArrived(w, v);
  }
}

function overflowThreshold(w: WorldState): number {
  return w.weather === 'heatwave' ? HEATWAVE_OVERFLOW_PCT : OVERFLOW_PCT;
}

function sensorRound(w: WorldState): void {
  const threshold = overflowThreshold(w);
  let full = 0;
  for (const b of w.bins) {
    const truth = binFillPct(w, b, w.t);
    if (truth >= threshold) full++;
    const { reading, next } = readSensor(truth, b.sensor, keyedRng(w.spec.seed, 'sensor', b.site.id, w.t), w.config.sensor);
    b.sensor = next;
    // M3-D5: score the forecast for this reading, then learn from it (services come from the GPS log).
    const served = b.lastServicedAt !== null && b.lastServicedAt > (b.lastReadingAt ?? -1);
    const profile = w.profiles[b.site.id]!;
    if (reading.status === 'ok' && reading.fillPct !== null && !served) {
      const f = profile.predict(w.t);
      if (f) w.forecastError.record(f.pct, reading.fillPct);
    }
    const observed: ObservedReading = { t: w.t, pct: reading.fillPct, status: reading.status };
    profile.observe(observed, served);
    b.history.push(observed);
    if (b.history.length > HISTORY_READINGS) b.history.shift();
    b.lastReadingAt = w.t;
    if (reading.fillPct !== null && reading.status === 'ok') {
      b.recent.push({ t: w.t, pct: reading.fillPct });
      if (b.recent.length > 2) b.recent.shift();
    }
    w.today.readings++;
    emit(w, { t: w.t, kind: 'SensorReading', binId: b.site.id, fillPct: reading.fillPct, status: reading.status });
  }
  w.today.overflowHours += (full * SENSOR_PERIOD_SEC) / 3600;
}

// --- Dispatch of events and timers --------------------------------------------------------------------------------

function onTraffic(w: WorldState, ev: TrafficEvent): void {
  const v = w.vehicles[ev.id]!;
  if (ev.kind === 'Departed') return;
  if (ev.kind === 'ReachedStop') {
    if (v.kind === 'auto-tipper') tipperStop(w, v, ev.tag);
    else resume(w.traffic, v.id);
    return;
  }
  v.parkedNode = currentNode(w, v);
  if (v.kind === 'auto-tipper') tipperArrived(w, v);
  else if (v.kind === 'compactor') compactorArrived(w, v);
  else crewArrived(w, v);
}

function onTimer(w: WorldState, v: VehicleRt, kind: TimerKind): void {
  switch (kind) {
    case 'shiftStart':
      if (v.kind === 'auto-tipper') startTipperShift(w, v);
      else if (v.kind === 'compactor') startCompactorShift(w, v);
      return;
    case 'shiftEnd':
      if (v.kind === 'auto-tipper') tipperShiftEnd(w, v);
      else if (v.kind === 'compactor' && v.fsm.kind === 'Waiting') {
        compactorTo(v, { kind: 'GoHome' });
        sendHome(w, v);
      }
      return;
    case 'earlyReturn':
      if (v.kind === 'auto-tipper' && (v.fsm.kind === 'ToBeat' || v.fsm.kind === 'Driving' || v.fsm.kind === 'Serving' || v.fsm.kind === 'Deviating')) tipperShiftEnd(w, v, 'early-return');
      return;
    case 'dwell':
      if (v.kind === 'auto-tipper') finishService(w, v);
      return;
    case 'tip':
      if (v.kind === 'auto-tipper') finishTip(w, v);
      return;
    case 'load':
      if (v.kind === 'compactor') finishLoading(w, v);
      return;
    case 'weigh':
      if (v.kind === 'compactor') finishWeighing(w, v);
      return;
    case 'unload':
      if (v.kind !== 'auto-tipper') finishUnloading(w, v, v.kind === 'compactor' && v.fsm.kind === 'Unloading' ? v.fsm.site : 'Landfill');
      return;
    case 'offMapArrive':
      if (v.kind === 'compactor') compactorTo(v, { kind: 'ArrivedAtLandfill' });
      setTimer(w, v, 'unload', w.t + UNLOAD_SEC);
      return;
    case 'offMapReturn':
      v.offMap = false;
      v.parkedNode = w.map.facilities.landfill.exitNode;
      if (v.kind === 'compactor') continueCompactor(w, v);
      return;
    case 'breakdown':
      breakDown(w, v);
      return;
    case 'repair':
      repair(w, v);
      return;
    case 'clear':
      if (v.kind === 'crew') finishClearing(w, v);
      return;
  }
}

function runTimers(w: WorldState): void {
  for (const v of w.vehicles) {
    for (;;) {
      let due = -1;
      for (let i = 0; i < v.timers.length; i++) if (v.timers[i]!.at <= w.t && (due < 0 || v.timers[i]!.at < v.timers[due]!.at)) due = i;
      if (due < 0) break;
      const [timer] = v.timers.splice(due, 1);
      onTimer(w, v, timer!.kind);
    }
  }
}

function computeNextWake(w: WorldState): SimTime {
  let next = (Math.floor(w.t / SENSOR_PERIOD_SEC) + 1) * SENSOR_PERIOD_SEC;
  for (const v of w.vehicles) for (const tm of v.timers) if (tm.at < next) next = tm.at;
  return next;
}

// --- Construction -------------------------------------------------------------------------------------------------

interface StaticPlan {
  readonly walks: (BeatWalk | null)[];
  readonly binsAt: Map<number, number[]>[];
  /** Transfer point of each tipper's beat. */
  readonly tipperTp: number[];
  /** Home transfer point of each compactor. */
  readonly compactorTp: number[];
}

/**
 * Today's practice (R-1 static policy): fixed beats, each handing over at the transfer point nearest its household
 * centre, and compactors allocated to transfer points by expected tonnage (at least one each where possible).
 */
function buildStaticPlan(map: MapData, fleet: FleetConfig, seed: number): StaticPlan {
  const g = map.graph;
  const served = map.segments.filter((s) => s.households > 0);
  const walks: (BeatWalk | null)[] = new Array<BeatWalk | null>(fleet.autoTippers).fill(null);
  const binsAt = Array.from({ length: fleet.autoTippers }, () => new Map<number, number[]>());
  const tipperTp = new Array<number>(fleet.autoTippers).fill(0);
  const tps = map.facilities.transferPoints;
  const demand = tps.map(() => 0);
  const k = Math.min(fleet.autoTippers, served.length);
  if (k === 0 || tps.length === 0) return { walks, binsAt, tipperTp, compactorTp: Array.from({ length: fleet.compactors }, (_, i) => (tps.length > 0 ? i % tps.length : 0)) };
  const beats = partitionBeats(g, served, k, seed);
  const depot = map.facilities.depotNode;
  beats.forEach((beat, i) => {
    // Start at the beat's segment end closest to the depot.
    let start = g.edgeFrom[served[beat.segmentIds[0]!]!.edges[0]!]!;
    let best = Infinity;
    for (const pos of beat.segmentIds) {
      for (const e of served[pos]!.edges) {
        const n = g.edgeFrom[e]!;
        const d = Math.hypot(g.nodeX[n]! - g.nodeX[depot]!, g.nodeY[n]! - g.nodeY[depot]!);
        if (d < best) {
          best = d;
          start = n;
        }
      }
    }
    const walk = orderBeat(g, served, beat, start);
    // Walk positions refer to `served`; translate them back to segment ids, then 2-opt the order (DV-3, M3-D6).
    walks[i] = improveWalk(g, map.segments, { ...walk, order: walk.order.map((pos) => served[pos]!.id) }, start);
    let cx = 0;
    let cy = 0;
    for (const pos of beat.segmentIds) {
      const e = served[pos]!.edges[0]!;
      const h = served[pos]!.households;
      cx += ((g.nodeX[g.edgeFrom[e]!]! + g.nodeX[g.edgeTo[e]!]!) / 2) * h;
      cy += ((g.nodeY[g.edgeFrom[e]!]! + g.nodeY[g.edgeTo[e]!]!) / 2) * h;
    }
    cx /= Math.max(1, beat.households);
    cy /= Math.max(1, beat.households);
    let tp = 0;
    tps.forEach((t, j) => {
      if (Math.hypot(g.nodeX[t.node]! - cx, g.nodeY[t.node]! - cy) < Math.hypot(g.nodeX[tps[tp]!.node]! - cx, g.nodeY[tps[tp]!.node]! - cy)) tp = j;
    });
    tipperTp[i] = tp;
    demand[tp]! += beat.households;
  });
  // Compactors: one per transfer point with demand (busiest first), the rest by largest remainder of demand.
  const byDemand = tps.map((_, j) => j).filter((j) => demand[j]! > 0).sort((a, b) => demand[b]! - demand[a]! || a - b);
  const counts = tps.map(() => 0);
  let left = fleet.compactors;
  for (const j of byDemand) {
    if (left === 0) break;
    counts[j]!++;
    left--;
  }
  const totalDemand = demand.reduce((a, d) => a + d, 0);
  while (left > 0 && totalDemand > 0) {
    let best = byDemand[0]!;
    for (const j of byDemand) if (demand[j]! / (counts[j]! + 1) > demand[best]! / (counts[best]! + 1)) best = j;
    counts[best]!++;
    left--;
  }
  const compactorTp: number[] = [];
  counts.forEach((c, j) => {
    for (let n = 0; n < c; n++) compactorTp.push(j);
  });
  while (compactorTp.length < fleet.compactors) compactorTp.push(compactorTp.length % tps.length);
  for (const bin of map.bins) {
    if (bin.kind === 'transfer-point') continue;
    found: for (let i = 0; i < walks.length; i++) {
      const walk = walks[i];
      if (!walk) continue;
      for (let e = 0; e < walk.edges.length; e++) {
        if (g.edgeTo[walk.edges[e]!] !== bin.node) continue;
        const list = binsAt[i]!.get(e);
        if (list) list.push(bin.id);
        else binsAt[i]!.set(e, [bin.id]);
        break found;
      }
    }
  }
  return { walks, binsAt, tipperTp, compactorTp };
}

export function createWorld(map: MapData, config: WorldConfig, spec: ScenarioSpec, options: WorldOptions = {}): World {
  const g = map.graph;
  const profiles = defaultProfiles();
  const streams = createStreams(spec.seed);
  let maxSpeed = 1;
  for (const s of g.edgeFreeSpeedMps) if (s > maxSpeed) maxSpeed = s;
  const speedRef = { model: config.speed };
  const traffic = createTraffic(g, (edge, t) => edgeSpeedMps(g, edge, bucketOf(secondOfDay(t)), speedRef.model));

  const tps: TpRt[] = map.facilities.transferPoints.map((tp) => ({ id: tp.id, node: tp.node, stockKg: 0, bay: -1, queue: [], binId: -1 }));
  const bins: BinRt[] = map.bins.map((site) => {
    const tp = site.kind === 'transfer-point' ? tps.findIndex((x) => x.node === site.node) : -1;
    if (tp >= 0) tps[tp]!.binId = site.id;
    return {
      site,
      profile: site.profile === 'market' ? profiles.market : profiles.household,
      accFrom: 0,
      carried: 0,
      sensor: { status: 'ok', lastReportedPct: null },
      tp,
      recent: [],
      lastServicedAt: null,
      history: [],
      lastReadingAt: null,
    };
  });

  const plan = buildStaticPlan(map, config.fleet, streams.layout.nextU32());
  const vehicles: VehicleRt[] = [];
  const depot = map.facilities.depotNode;
  const base = (kind: VehicleKind, payloadKg: number): VehicleBase => ({
    id: vehicles.length,
    kind,
    payloadKg,
    loadKg: 0,
    parkedNode: depot,
    offMap: false,
    timers: [],
    interrupted: null,
    odoBankM: 0,
    shiftStartOdoM: 0,
    servedToday: 0,
    skippedToday: 0,
    servedSegs: new Set(),
    skippedSegs: new Set(),
    servedBins: new Set(),
    midnightOdoM: 0,
    deviationsToday: 0,
  });
  for (let i = 0; i < config.fleet.autoTippers; i++) {
    const walk = plan.walks[i] ?? null;
    vehicles.push({
      ...base('auto-tipper', config.fleet.tipperPayloadKg),
      kind: 'auto-tipper',
      fsm: { kind: 'OffShift' },
      walk,
      binsAt: plan.binsAt[i]!,
      orderIndex: new Map(walk?.order.map((seg, k) => [seg, k]) ?? []),
      reroute: false,
      nextServe: 0,
      serving: 0,
      shiftEnd: 0,
      homeTp: plan.tipperTp[i]!,
    });
  }
  for (let i = 0; i < config.fleet.compactors; i++) {
    vehicles.push({ ...base('compactor', config.fleet.compactorPayloadKg), kind: 'compactor', fsm: { kind: 'OffShift' }, homeTp: plan.compactorTp[i]!, run: 0, day: 0, tp: 0, shiftEnd: 0 });
  }
  for (let i = 0; i < config.fleet.crews; i++) {
    vehicles.push({ ...base('crew', Number.POSITIVE_INFINITY), kind: 'crew', fsm: { kind: 'Idle' } });
  }

  const w: WorldState = {
    spec,
    map,
    config,
    streams,
    traffic,
    household: profiles.household,
    segs: map.segments.map((seg) => ({ seg, dailyKg: seg.households * config.householdKgPerDay, lastServedAt: 0, accFrom: 0, carried: 0, skips: [] })),
    bins,
    spots: map.blackSpots.map((site) => ({ site, fsm: { kind: 'Dormant' }, activatedAt: 0, assigned: false })),
    tps,
    vehicles,
    maxSpeedMps: maxSpeed,
    t: 0,
    nextWake: Number.POSITIVE_INFINITY,
    events: [],
    delivered: { kcdc: 0, landfill: 0 },
    kcdcIntakeByDay: new Map(),
    weather: 'clear',
    get speed() {
      return speedRef.model;
    },
    set speed(m: SpeedModel) {
      speedRef.model = m;
    },
    weatherSpans: [],
    closed: new Set(),
    lineage: new Lineage(),
    today: newDay(0),
    routedAt: new Map(),
    enRouteAt: new Map(),
    policy: spec.policy,
    planner: options.planner ?? null,
    plannerMap: buildPlannerMap(map, config, spec, plan, profiles.household),
    staticWalks: plan.walks,
    staticBins: plan.binsAt,
    staticOwner: staticOwners(map, plan.walks),
    requests: [],
    nextReqId: 1,
    pendingStatic: null,
    explain: Array.from({ length: config.fleet.autoTippers }, () => ({ day: 0, dynamic: false, planned: [], deferred: [], replans: [] })),
    profiles: bins.map(() => new FillProfile(weekdayOf(spec.startDate))),
    forecastError: new ForecastError(),
    rHat: new RateLearner(config.householdKgPerDay),
    weighedByDay: [0],
    householdDaysByDay: [0],
    leaked: 0,
    dumpSpot: nearestSpots(map, config.dumpRadiusM ?? DEFAULT_DUMP_RADIUS_M),
    spotSizeHourAgo: map.blackSpots.map(() => 0),
  };
  if (spec.weather !== 'clear') changeWeather(w, spec.weather);
  for (const v of vehicles) if (v.kind !== 'crew') scheduleNextShift(w, v);
  w.nextWake = computeNextWake(w);
  return w;
}

/**
 * Advances exactly one second (fixed dt, AD-5): a step from t to t + 1 processes instant t + 1, and the events it
 * emits carry t + 1. Periodic work (sensor readings every 900 s, hourly black-spot checks) happens at multiples of
 * its period, so the first sensor reading is at t = 900.
 */
export function stepWorld(world: World): void {
  const w = ws(world);
  // M3-D9: a plan due now that has not arrived holds the clock; once it has, it is applied at this instant.
  if (planDue(w)) {
    if (holding(w)) return;
    applyDuePlans(w);
  }
  const t0 = w.t;
  w.t = t0 + 1;
  if (w.t % DAY_SEC === 0) {
    startKpiDay(w);
    leakStaleBacklog(w);
  }
  if (!isIdle(w.traffic, w.t)) for (const ev of stepTraffic(w.traffic, t0, 1)) onTraffic(w, ev);
  if (w.t >= w.nextWake) {
    runTimers(w);
    if (w.t % SENSOR_PERIOD_SEC === 0) {
      sensorRound(w);
      dispatchRound(w);
    }
    if (w.t % 3600 === 0) hourlyBlackSpots(w);
    w.nextWake = computeNextWake(w);
  }
  if (secondOfDay(w.t) === DAILY_CUTOFF_SEC) dailyCutoff(w);
  if (w.pendingStatic === w.t) applyStatic(w);
  if (planDue(w) && !holding(w)) applyDuePlans(w);
}

/**
 * Steps until worldTime(world) === t. Throws RangeError if t is in the past, and Error if the world is held waiting
 * for a plan (a Dynamic world without an inline planner must be stepped and answered by its host).
 */
export function runUntil(world: World, t: SimTime): void {
  const w = ws(world);
  if (t < w.t) throw new RangeError(`Cannot run back in time from ${w.t} to ${t}`);
  while (w.t < t) {
    stepWorld(world);
    if (holding(w)) throw new Error(`World held at ${w.t}: plan ${w.requests.find((e) => e.result === null)?.req.reqId ?? '?'} has not arrived`);
  }
}

export function worldTime(world: World): SimTime {
  return ws(world).t;
}

/** Events since the previous drain, in time order. */
export function drainEvents(world: World): SimEvent[] {
  const w = ws(world);
  const out = w.events;
  w.events = [];
  return out;
}

export function vehicles(world: World): VehicleSummary[] {
  return ws(world).vehicles.map((v) => ({ id: v.id, kind: v.kind, state: v.fsm.kind }));
}

export function massBalance(world: World): MassBalance {
  const w = ws(world);
  let generated = 0;
  let uncollected = 0;
  for (const s of w.segs) {
    generated += genKg(w, s.dailyKg, w.household, 0, w.t, 0, s.seg.id);
    uncollected += segAmount(w, s, w.t);
  }
  for (const b of w.bins) {
    generated += genKg(w, b.site.dailyKg, b.profile, 0, w.t, 1, b.site.id);
    uncollected += binAmount(w, b, w.t);
  }
  for (const spot of w.spots) if (spot.fsm.kind !== 'Dormant') uncollected += spot.fsm.sizeKg;
  return {
    generatedKg: generated,
    uncollectedKg: uncollected,
    onVehiclesKg: w.vehicles.reduce((a, v) => a + v.loadKg, 0),
    atTransferPointsKg: w.tps.reduce((a, tp) => a + tp.stockKg, 0),
    deliveredKcdcKg: w.delivered.kcdc,
    deliveredLandfillKg: w.delivered.landfill,
    leakedKg: w.leaked,
  };
}

// --- M3: policy, planning and explanations (architecture §10) ----------------------------------------------------

/** Weekday of a date, 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
function weekdayOf(date: string): number {
  const civil = parseCivil(date);
  if (!civil) return 0;
  return (((daysFromCivil(...civil) + 3) % 7) + 7) % 7;
}

/** The keyed absence draw (M3-D1, keys: tipper, day): the roll call known at the 05:00 cut-off. */
function absentOn(w: WorldState, tipperId: number, day: number): boolean {
  return keyedChance(w.spec.seed, 'absence', w.spec.levers.tipperAbsenceRate, tipperId, day);
}

const midpointOf = (g: MapData['graph'], seg: StreetSegment): { x: number; y: number } => {
  const e = seg.edges[0]!;
  return { x: (g.nodeX[g.edgeFrom[e]!]! + g.nodeX[g.edgeTo[e]!]!) / 2, y: (g.nodeY[g.edgeFrom[e]!]! + g.nodeY[g.edgeTo[e]!]!) / 2 };
};

/** Static facts for the planner (M3-D4): served segments, their neighbours, the static beats, bins and spots. */
function buildPlannerMap(map: MapData, config: WorldConfig, spec: ScenarioSpec, plan: StaticPlan, household: DailyProfile): PlannerMap {
  const g = map.graph;
  const served = map.segments.filter((s) => s.households > 0);
  const byNode = new Map<number, number[]>();
  for (const s of served) {
    for (const e of s.edges) {
      for (const n of [g.edgeFrom[e]!, g.edgeTo[e]!]) {
        const list = byNode.get(n);
        if (!list) byNode.set(n, [s.id]);
        else if (!list.includes(s.id)) list.push(s.id);
      }
    }
  }
  const segments = served.map((s) => {
    const neighbours = new Set<number>();
    for (const e of s.edges) for (const n of [g.edgeFrom[e]!, g.edgeTo[e]!]) for (const o of byNode.get(n) ?? []) if (o !== s.id) neighbours.add(o);
    return {
      id: s.id,
      households: s.households,
      ...midpointOf(g, s),
      serviceSec: Math.max(MIN_SERVICE_SEC, SERVICE_SEC_PER_HOUSEHOLD * s.households),
      neighbours: [...neighbours].sort((a, b) => a - b),
    };
  });
  const binSegments = map.bins.map((b) => {
    const touching = byNode.get(b.node);
    if (touching && touching.length > 0) return Math.min(...touching);
    let best = -1;
    let bestD = Infinity;
    for (const s of segments) {
      const d = Math.hypot(s.x - g.nodeX[b.node]!, s.y - g.nodeY[b.node]!);
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  });
  const node = (n: number): { x: number; y: number } => ({ x: g.nodeX[n]!, y: g.nodeY[n]! });
  return {
    segments,
    transferPoints: map.facilities.transferPoints.map((tp) => ({ id: tp.id, ...node(tp.node) })),
    depot: node(map.facilities.depotNode),
    beats: plan.walks.map((walk, i) => ({ tipperId: i, segments: walk?.order ?? [], tp: plan.tipperTp[i]! })),
    binSegments,
    spotSegments: map.blackSpots.map((s) => s.segmentIds),
    householdProfile: household,
    startWeekday: weekdayOf(spec.startDate),
    rPrior: config.householdKgPerDay,
    tipperPayloadKg: config.fleet.tipperPayloadKg,
    tipperShift: config.fleet.tipperShift,
  };
}

function staticOwners(map: MapData, walks: readonly (BeatWalk | null)[]): Int32Array {
  const owner = new Int32Array(map.segments.length).fill(-1);
  walks.forEach((walk, i) => {
    for (const s of walk?.order ?? []) owner[s] = i;
  });
  return owner;
}

/** M3-D2: each segment's nearest black spot within the dump radius, or −1. */
function nearestSpots(map: MapData, radiusM: number): Int32Array {
  const g = map.graph;
  const out = new Int32Array(map.segments.length).fill(-1);
  if (radiusM <= 0 || map.blackSpots.length === 0) return out;
  for (const s of map.segments) {
    const m = midpointOf(g, s);
    let best = -1;
    let bestD = radiusM;
    for (const spot of map.blackSpots) {
      const d = Math.hypot(g.nodeX[spot.node]! - m.x, g.nodeY[spot.node]! - m.y);
      if (d <= bestD) {
        bestD = d;
        best = spot.id;
      }
    }
    out[s.id] = best;
  }
  return out;
}

const ROUTING_POLICIES: readonly RoutingPolicy[] = ['static', 'dynamic'];

const ON_SHIFT = new Set(['ToBeat', 'Driving', 'Serving', 'ToTransfer', 'Tipping', 'BrokenDown', 'Deviating']);

function tippersOnShift(w: WorldState): number[] {
  return w.vehicles.filter((v): v is TipperRt => v.kind === 'auto-tipper' && ON_SHIFT.has(v.fsm.kind)).map((v) => v.id);
}

/** The nearest tippers on shift (not broken down) to a vehicle, by straight line, nearest first. */
function nearestOnShift(w: WorldState, v: VehicleRt, n: number): number[] {
  const g = w.map.graph;
  const here = currentNode(w, v);
  return w.vehicles
    .filter((o): o is TipperRt => o.kind === 'auto-tipper' && o.id !== v.id && ON_SHIFT.has(o.fsm.kind) && o.fsm.kind !== 'BrokenDown')
    .map((o) => {
      const at = currentNode(w, o);
      return { id: o.id, d: Math.hypot(g.nodeX[at]! - g.nodeX[here]!, g.nodeY[at]! - g.nodeY[here]!) };
    })
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .slice(0, n)
    .map((x) => x.id);
}

/** Freezes the operator view now and asks for a plan due later (inline planner: answered at once). */
function requestPlan(w: WorldState, cause: PlanCause, vehicleIds: readonly number[]): void {
  const daily = cause === 'daily';
  const req: PlanRequest = {
    reqId: w.nextReqId++,
    cause,
    madeAt: w.t,
    dueAt: w.t + (daily ? DAILY_PLAN_SEC - DAILY_CUTOFF_SEC : REPLAN_DELAY_SEC),
    view: observe(w),
    map: w.plannerMap,
    budget: daily ? DAILY_BUDGET : REPLAN_BUDGET,
    vehicleIds: [...vehicleIds],
  };
  let result: PlanResult | null = null;
  if (w.planner) {
    try {
      result = w.planner(req);
    } catch (e) {
      result = { reqId: req.reqId, error: e instanceof Error ? e.message : String(e) };
    }
  }
  w.requests.push({ req, result });
}

const planDue = (w: WorldState): boolean => w.requests.some((e) => e.req.dueAt <= w.t);
const holding = (w: WorldState): boolean => w.requests.some((e) => e.req.dueAt <= w.t && e.result === null);

function applyDuePlans(w: WorldState): void {
  const due = w.requests.filter((e) => e.req.dueAt <= w.t).sort((a, b) => a.req.dueAt - b.req.dueAt || a.req.reqId - b.req.reqId);
  for (const e of due) {
    w.requests.splice(w.requests.indexOf(e), 1);
    const result = e.result!;
    if ('error' in result) {
      planFailed(w, e.req, result.error);
      continue;
    }
    const problems = validatePlan(e.req, result);
    if (problems.length > 0) planFailed(w, e.req, problems.join('; '));
    else applyPlan(w, e.req, result);
  }
  w.nextWake = Math.min(w.nextWake, computeNextWake(w));
}

function todaysExplain(w: WorldState, tipperId: number): TipperExplain | null {
  const e = w.explain[tipperId];
  if (!e) return null;
  const day = dayIndex(w.t);
  if (e.day !== day) {
    e.day = day;
    e.dynamic = false;
    e.planned = [];
    e.deferred = [];
    e.replans = [];
  }
  return e;
}

function logReplan(w: WorldState, cause: PlanCause, vehicleIds: readonly number[]): void {
  for (const id of vehicleIds) todaysExplain(w, id)?.replans.push({ t: w.t, cause, vehicleIds });
}

/** M3-D9: a failed plan falls back to the static beats for the tippers it covered, and says why. */
function planFailed(w: WorldState, req: PlanRequest, reason: string): void {
  emit(w, { t: w.t, kind: 'PlanFailed', cause: req.cause, reason });
  for (const id of req.vehicleIds) {
    const v = w.vehicles[id];
    if (v?.kind === 'auto-tipper') installStatic(w, v);
  }
}

function applyPlan(w: WorldState, req: PlanRequest, plan: DayPlan): void {
  const day = dayIndex(w.t);
  // lastServedAt is 0 for a street never served, so "today" means strictly after midnight.
  const servedToday = (segId: number): boolean => w.segs[segId]!.lastServedAt > day * DAY_SEC;
  for (const id of req.vehicleIds) {
    const v = w.vehicles[id];
    if (v?.kind !== 'auto-tipper') continue;
    const stops = (plan.routes.find((r) => r.vehicleId === id)?.stops ?? []).filter((st) => !servedToday(st.segmentId));
    install(
      w,
      v,
      stops.map((st) => st.segmentId),
    );
    const e = todaysExplain(w, id)!;
    e.dynamic = true;
    e.planned = [...stops];
    // Deferrals are re-listed for the streets this plan covered.
    e.deferred = e.deferred.filter((d) => !plan.deferred.some((x) => x.segmentId === d.segmentId));
  }
  for (const d of plan.deferred) {
    const owner = w.staticOwner[d.segmentId]!;
    const e = todaysExplain(w, owner >= 0 ? owner : (req.vehicleIds[0] ?? 0));
    if (!e) continue;
    e.deferred = e.deferred.filter((x) => x.segmentId !== d.segmentId);
    e.deferred.push(d);
    // Deferred streets still count as scheduled today (K-3): deferring is not a way to look on time.
    if (d.reason !== 'closed' && !w.today.jobs.has(`seg:${d.segmentId}`)) w.today.jobs.set(`seg:${d.segmentId}`, { start: w.t, end: day * DAY_SEC + w.config.fleet.tipperShift[1], servedAt: null });
  }
  emit(w, { t: w.t, kind: 'Replanned', cause: req.cause, vehicleIds: req.vehicleIds, deferredMustServe: plan.deferred.filter((d) => d.mustServe && d.reason === 'capacity').length });
  logReplan(w, req.cause, req.vehicleIds);
}

/** Bins served along a walk: the non-transfer-point bins on its streets that are not yet served today. */
function binsAlong(w: WorldState, walk: BeatWalk): Map<number, number[]> {
  const g = w.map.graph;
  const onRoute = new Set(walk.order);
  const out = new Map<number, number[]>();
  const day = dayIndex(w.t);
  w.map.bins.forEach((bin, i) => {
    if (bin.kind === 'transfer-point' || !onRoute.has(w.plannerMap.binSegments[i]!)) return;
    const last = w.bins[i]!.lastServicedAt;
    if (last !== null && last >= day * DAY_SEC) return;
    let k = walk.edges.findIndex((e) => g.edgeTo[e] === bin.node);
    if (k < 0) k = walk.serviceEdgeIndex[walk.order.indexOf(w.plannerMap.binSegments[i]!)]!;
    const list = out.get(k);
    if (list) list.push(bin.id);
    else out.set(k, [bin.id]);
  });
  return out;
}

const EMPTY_WALK: BeatWalk = { order: [], edges: [], serviceEdgeIndex: [], lengthM: 0 };

/** Installs a new walk (in this order) for a tipper, re-routing it now or as soon as its current stop ends. */
function install(w: WorldState, v: TipperRt, order: readonly number[]): void {
  const offShift = v.fsm.kind === 'OffShift' || v.fsm.kind === 'Absent';
  const start = offShift ? w.map.facilities.depotNode : currentNode(w, v);
  const walk = order.length > 0 ? walkInOrder(w.map.graph, w.map.segments, order, start) : EMPTY_WALK;
  v.walk = walk;
  v.orderIndex = new Map(walk.order.map((seg, k) => [seg, k]));
  v.binsAt = binsAlong(w, walk);
  v.nextServe = 0;
  const day = dayIndex(w.t);
  if (w.routedAt.has(`${v.id}:${day}`)) {
    for (const segId of walk.order) if (!w.today.jobs.has(`seg:${segId}`)) w.today.jobs.set(`seg:${segId}`, { start: w.t, end: v.shiftEnd, servedAt: null });
  }
  if (offShift || v.fsm.kind === 'ToDepot' || v.fsm.kind === 'ToTransfer' || v.fsm.kind === 'Tipping') return;
  if ((v.fsm.kind === 'ToBeat' || v.fsm.kind === 'Driving') && !v.timers.some((tm) => tm.kind === 'dwell')) {
    continueBeat(w, v);
    return;
  }
  v.reroute = true;
}

/** Back to the static beat: the whole walk if off shift, else what is left of it from here. */
function installStatic(w: WorldState, v: TipperRt): void {
  const e = todaysExplain(w, v.id);
  if (e) e.dynamic = false;
  const walk = w.staticWalks[v.id] ?? null;
  if (v.fsm.kind === 'OffShift' || v.fsm.kind === 'Absent') {
    v.walk = walk;
    v.orderIndex = new Map(walk?.order.map((seg, k) => [seg, k]) ?? []);
    v.binsAt = new Map([...w.staticBins[v.id]!].map(([k, ids]) => [k, [...ids]]));
    v.nextServe = 0;
    return;
  }
  const day = dayIndex(w.t);
  const left = (walk?.order ?? []).filter((s) => w.segs[s]!.lastServedAt <= day * DAY_SEC && !v.skippedSegs.has(s));
  install(w, v, left);
}

/** M3-1: the switch to Static takes effect. */
function applyStatic(w: WorldState): void {
  w.pendingStatic = null;
  const affected: number[] = [];
  for (const v of w.vehicles) {
    if (v.kind === 'auto-tipper') {
      installStatic(w, v);
      affected.push(v.id);
    } else if (v.kind === 'compactor' && v.fsm.kind === 'Waiting') {
      // Back on the fixed slots: the next slot that still leaves time for a run, else home.
      let run = 0;
      while (slot(v, run) < w.t) run++;
      if (slot(v, run) + COMPACTOR_RUN_SEC <= v.shiftEnd) {
        v.run = run;
        compactorTo(v, { kind: 'Dispatch' });
        sendToNextTp(w, v);
      } else {
        compactorTo(v, { kind: 'GoHome' });
        sendHome(w, v);
      }
    }
  }
  emit(w, { t: w.t, kind: 'Replanned', cause: 'policy', vehicleIds: affected, deferredMustServe: 0 });
  logReplan(w, 'policy', affected);
}

/** 05:00: Dynamic asks for today's plan; Static makes sure every tipper has its fixed beat. */
function dailyCutoff(w: WorldState): void {
  const day = dayIndex(w.t);
  for (let i = 0; i < w.explain.length; i++) todaysExplain(w, i);
  if (w.policy === 'dynamic') {
    const present = w.vehicles.filter((v) => v.kind === 'auto-tipper' && !absentOn(w, v.id, day)).map((v) => v.id);
    requestPlan(w, 'daily', present);
    return;
  }
  for (const v of w.vehicles) if (v.kind === 'auto-tipper' && v.walk !== w.staticWalks[v.id]) installStatic(w, v);
}

/**
 * 00:00: part of the stale backlog (streets over 48 h, and active black spots) leaves the system (M3-D2); r̂ learns
 * from yesterday's weigh-ins (M3-D5).
 */
function leakStaleBacklog(w: WorldState): void {
  const day = dayIndex(w.t);
  while (w.weighedByDay.length <= day) w.weighedByDay.push(0);
  while (w.householdDaysByDay.length <= day) w.householdDaysByDay.push(0);
  w.rHat.update(w.weighedByDay[day - 1] ?? 0, w.householdDaysByDay[day - 1] ?? 0);
  const share = w.config.leakageSharePerDay ?? 0;
  if (share <= 0) return;
  for (const s of w.segs) {
    if (w.t - s.lastServedAt <= STALE_SEC) continue;
    w.leaked += takeFromSeg(w, s, w.t, segAmount(w, s, w.t) * share);
  }
  // Waste dumped at an active black spot is stale by definition: the same share leaves it.
  for (const spot of w.spots) {
    if (spot.fsm.kind !== 'Active') continue;
    const kg = spot.fsm.sizeKg * share;
    spot.fsm = blackSpotNext(spot.fsm, { kind: 'Leak', kg });
    w.leaked += kg;
  }
}

function addHouseholdDays(w: WorldState, hd: number): void {
  const day = dayIndex(w.t);
  while (w.householdDaysByDay.length <= day) w.householdDaysByDay.push(0);
  w.householdDaysByDay[day]! += hd;
}

/** M3-D7: under Dynamic, send waiting compactors to the transfer points forecast to need them. */
function dispatchRound(w: WorldState): void {
  if (w.policy !== 'dynamic') return;
  const g = w.map.graph;
  const free = w.vehicles.filter((v): v is CompactorRt => v.kind === 'compactor' && v.fsm.kind === 'Waiting' && !v.offMap && w.t + COMPACTOR_RUN_SEC <= v.shiftEnd);
  if (free.length === 0) return;
  const busy = new Set(w.vehicles.filter((v): v is CompactorRt => v.kind === 'compactor' && (v.fsm.kind === 'ToTransferPoint' || v.fsm.kind === 'Queued' || v.fsm.kind === 'Loading')).map((v) => v.tp));
  const outlooks: TransferPointOutlook[] = w.tps
    .filter((tp) => !busy.has(tp.id))
    .map((tp) => {
      const bin = tp.binId >= 0 ? w.bins[tp.binId]! : null;
      const profile = bin ? w.profiles[bin.site.id]! : null;
      return {
        tp: tp.id,
        predictPct: (at: SimTime) => profile?.predict(at)?.pct ?? bin?.sensor.lastReportedPct ?? 0,
        tippersDue: w.vehicles.filter((v) => v.kind === 'auto-tipper' && v.homeTp === tp.id && (v.fsm.kind === 'ToTransfer' || v.fsm.kind === 'Tipping')).length,
      };
    });
  const travel = (from: number, to: number): number => (Math.hypot(g.nodeX[from]! - g.nodeX[to]!, g.nodeY[from]! - g.nodeY[to]!) * COMPACTOR_DETOUR) / COMPACTOR_EST_MPS;
  const byId = new Map(free.map((v) => [v.id, v]));
  const assignments = dispatchCompactors(
    w.t,
    free.map((v) => ({ id: v.id, travelSecTo: (tp: number) => travel(v.parkedNode, w.tps[tp]!.node) })),
    outlooks,
  );
  for (const a of assignments) {
    const v = byId.get(a.compactorId)!;
    v.tp = a.tp;
    compactorTo(v, { kind: 'Dispatch' });
    if (!drive(w, v, w.tps[a.tp]!.node)) arriveAtTp(w, v);
  }
}

/** M3-1: switch the routing policy. The re-plan takes effect REPLAN_DELAY_SEC later; switches inside that window collapse. */
export function setPolicy(world: World, policy: RoutingPolicy): void {
  // Validated at run time: the policy can come from outside the type system (the worker protocol).
  if (!(ROUTING_POLICIES as readonly string[]).includes(policy)) throw new RangeError(`Unknown routing policy: ${policy}`);
  const w = ws(world);
  w.policy = policy;
  for (let i = w.requests.length - 1; i >= 0; i--) if (w.requests[i]!.req.cause === 'policy') w.requests.splice(i, 1);
  w.pendingStatic = null;
  if (policy === 'dynamic') {
    const day = dayIndex(w.t);
    const ids = w.vehicles.filter((v) => v.kind === 'auto-tipper' && v.fsm.kind !== 'ToDepot' && !absentOn(w, v.id, day)).map((v) => v.id);
    requestPlan(w, 'policy', ids);
  } else {
    w.pendingStatic = w.t + REPLAN_DELAY_SEC;
  }
  w.nextWake = Math.min(w.nextWake, w.t + 1);
}

export function currentPolicy(world: World): RoutingPolicy {
  return ws(world).policy;
}

/** M3-D4: the operator's view of the world now. */
export function observe(world: World): OperatorView {
  const w = ws(world);
  const g = w.map.graph;
  const day = dayIndex(w.t);
  const pos = (v: VehicleRt): { x: number; y: number } => {
    const n = currentNode(w, v);
    return { x: g.nodeX[n]!, y: g.nodeY[n]! };
  };
  const shift = (v: VehicleRt): [SimTime, SimTime] => {
    const f = v.kind === 'compactor' ? w.config.fleet.compactorShift : w.config.fleet.tipperShift;
    const stagger = v.kind === 'auto-tipper' ? v.id * TIPPER_STAGGER_SEC : 0;
    return [day * DAY_SEC + f[0] + stagger, day * DAY_SEC + f[1]];
  };
  const served = new Set(w.plannerMap.segments.map((s) => s.id));
  return {
    t: w.t,
    day,
    weather: w.weather,
    bins: w.bins.flatMap((b) => {
      const last = b.history[b.history.length - 1];
      return last ? [{ binId: b.site.id, reading: { fillPct: last.pct, status: last.status }, readAt: last.t }] : [];
    }),
    fleet: w.vehicles.map((v) => ({ vehicleId: v.id, kind: v.kind, available: v.fsm.kind !== 'BrokenDown' && !(v.kind === 'auto-tipper' && absentOn(w, v.id, day)) })),
    closedEdges: [...w.closed].sort((a, b) => a - b),
    sensors: w.bins.map((b) => ({ binId: b.site.id, tp: b.tp, history: [...b.history] })),
    segmentsLastServedAt: w.segs.map((s) => s.lastServedAt),
    binsLastServicedAt: w.bins.map((b) => b.lastServicedAt),
    roster: w.vehicles.map((v) => {
      const [shiftStart, shiftEnd] = shift(v);
      return {
        id: v.id,
        kind: v.kind,
        present: !(v.kind === 'auto-tipper' && absentOn(w, v.id, day)),
        brokenDown: v.fsm.kind === 'BrokenDown',
        ...pos(v),
        shiftStart,
        shiftEnd,
        tp: v.kind === 'crew' ? -1 : v.homeTp,
      };
    }),
    closedSegments: w.segs.filter((s) => served.has(s.seg.id) && segClosed(w, s.seg.id)).map((s) => s.seg.id),
    spots: w.spots.map((s) => ({ id: s.site.id, sizeKg: s.fsm.kind === 'Dormant' ? null : s.fsm.sizeKg, activeSince: s.fsm.kind === 'Dormant' ? null : s.activatedAt })),
    weighedKgByDay: [...w.weighedByDay],
    householdDaysByDay: [...w.householdDaysByDay],
    assignments: w.vehicles
      .filter((v): v is TipperRt => v.kind === 'auto-tipper')
      .map((v) => ({
        tipperId: v.id,
        remaining: (v.walk?.order ?? []).slice(v.nextServe).filter((s) => !v.servedSegs.has(s) && !v.skippedSegs.has(s) && w.segs[s]!.lastServedAt <= day * DAY_SEC),
      })),
  };
}

/** Plan requests waiting for an answer (oldest first). Empty with an inline planner. */
export function pendingPlanRequests(world: World): readonly PlanRequest[] {
  return ws(world)
    .requests.filter((e) => e.result === null)
    .map((e) => e.req);
}

/** Answers a request: a plan (validated before use) or an error (static fallback, `PlanFailed`). Unknown ids are ignored. */
export function providePlan(world: World, result: PlanResult): void {
  const entry = ws(world).requests.find((e) => e.req.reqId === result.reqId && e.result === null);
  if (entry) entry.result = result;
}

/** M3-D5: running mean absolute error of the sensored-point forecasts (fill points), or null before any was scored. */
export function forecastMae(world: World): number | null {
  return ws(world).forecastError.mae();
}

/** True while a plan is due but has not arrived: the clock holds and `stepWorld` does nothing. */
export function isHeld(world: World): boolean {
  return holding(ws(world));
}

export interface VehicleExplain {
  readonly policy: RoutingPolicy;
  /** Today's streets for this tipper with their reasons (Static: reason `beat`). */
  readonly planned: readonly PlannedStop[];
  /** Streets this tipper would have served that were deferred, with reasons. */
  readonly deferred: readonly Deferral[];
  readonly replans: readonly { readonly t: SimTime; readonly cause: PlanCause; readonly vehicleIds: readonly number[] }[];
}

/** M3-10: why a tipper's route is what it is; null for other vehicles. */
export function vehicleExplain(world: World, vehicleId: number): VehicleExplain | null {
  const w = ws(world);
  const v = w.vehicles[vehicleId];
  if (v?.kind !== 'auto-tipper') return null;
  const e = todaysExplain(w, vehicleId)!;
  const planned: PlannedStop[] = e.dynamic
    ? e.planned
    : (v.walk?.order ?? []).map((segId) => {
        const s = w.segs[segId]!;
        return {
          segmentId: segId,
          reason: 'beat' as const,
          predictedKg: segmentBacklogKg(s.seg.households, w.rHat.value(), s.lastServedAt, w.t, w.household),
          hoursSinceServed: Math.max(0, (w.t - s.lastServedAt) / 3600),
          confidence: 'normal' as const,
        };
      });
  return { policy: w.policy, planned, deferred: [...e.deferred], replans: [...e.replans] };
}

// --- Views for the renderer and UI (L-7) --------------------------------------------------------------------------

/** Fuel use per km (`assumed`): auto-tipper ~12 km/L, compactor ~2.5 km/L, crew lorry ~3.3 km/L, plus 15% idling. */
const LITRES_PER_KM: Readonly<Record<VehicleKind, number>> = { 'auto-tipper': 0.083, compactor: 0.4, crew: 0.3 };
const IDLE_ALLOWANCE = 1.15;
/** Parking-yard layout: rows of six, 4 m apart, rows 11 m apart, starting 14 m north of the facility node. */
const YARD = { perRow: 6, dx: 4, dy: 11, offset: 14 } as const;

/** Lane width used to draw vehicles off the centre line (`assumed`). */
const LANE_WIDTH_M = 2.8;

/**
 * Sideways offset (m, positive = left of travel) of a lane's centre. India keeps left, so both directions of a
 * two-way street sit left of the centre line; a one-way street's lanes are centred on it.
 */
export function laneOffsetM(g: MapData['graph'], edge: number, lane: number): number {
  if (g.edgeTwin[edge]! >= 0) return (lane + 0.5) * LANE_WIDTH_M;
  return (lane - (g.edgeLanes[edge]! - 1) / 2) * LANE_WIDTH_M;
}

export interface VehicleView {
  readonly id: number;
  readonly kind: VehicleKind;
  readonly state: string;
  readonly x: number;
  readonly y: number;
  /** Radians, counter-clockwise from east. */
  readonly heading: number;
  readonly speedMps: number;
  /** False while off the map (the landfill trip). */
  readonly visible: boolean;
  /** Current edge, or −1 when parked. */
  readonly edge: number;
  readonly loadKg: number;
  readonly payloadKg: number;
  readonly kmToday: number;
  readonly fuelLitresToday: number;
  readonly servedToday: number;
  readonly skippedToday: number;
}

export function vehicleViews(world: World): VehicleView[] {
  const w = ws(world);
  const g = w.map.graph;
  const yardSlot = new Map<number, number>();
  return w.vehicles.map((v) => {
    const place = vehiclePlace(w.traffic, v.id);
    const km = (odometerM(w, v) - v.shiftStartOdoM) / 1000;
    const common = {
      id: v.id,
      kind: v.kind,
      state: v.fsm.kind,
      loadKg: v.loadKg,
      payloadKg: Number.isFinite(v.payloadKg) ? v.payloadKg : 0,
      kmToday: km,
      fuelLitresToday: km * LITRES_PER_KM[v.kind] * IDLE_ALLOWANCE,
      servedToday: v.servedToday,
      skippedToday: v.skippedToday,
    };
    if (place?.status === 'active') {
      const p = pointAlongEdge(g, place.edge, place.s);
      const off = laneOffsetM(g, place.edge, place.lane);
      return { ...common, x: p.x - Math.sin(p.heading) * off, y: p.y + Math.cos(p.heading) * off, heading: p.heading, speedMps: place.speedMps, visible: true, edge: place.edge };
    }
    const node = v.parkedNode;
    const slot = yardSlot.get(node) ?? 0;
    yardSlot.set(node, slot + 1);
    const x = g.nodeX[node]! + ((slot % YARD.perRow) - (YARD.perRow - 1) / 2) * YARD.dx;
    const y = g.nodeY[node]! + YARD.offset + Math.floor(slot / YARD.perRow) * YARD.dy;
    return { ...common, x, y, heading: Math.PI / 2, speedMps: 0, visible: !v.offMap, edge: -1 };
  });
}

export interface BinView {
  readonly id: number;
  readonly kind: BinSite['kind'];
  readonly node: number;
  /** True fill (synthetic); the UI shows the sensor reading and keeps truth for the overflow KPI. */
  readonly trueFillPct: number;
  readonly reportedPct: number | null;
  readonly sensorStatus: SensorState['status'];
}

export function binViews(world: World): BinView[] {
  const w = ws(world);
  return w.bins.map((b) => ({
    id: b.site.id,
    kind: b.site.kind,
    node: b.site.node,
    trueFillPct: binFillPct(w, b, w.t),
    reportedPct: b.sensor.lastReportedPct,
    sensorStatus: b.sensor.status,
  }));
}

export interface BlackSpotView {
  readonly id: number;
  readonly node: number;
  readonly state: BlackSpotState['kind'];
  readonly sizeKg: number;
}

export function blackSpotViews(world: World): BlackSpotView[] {
  return ws(world).spots.map((s) => ({ id: s.site.id, node: s.site.node, state: s.fsm.kind, sizeKg: s.fsm.kind === 'Dormant' ? 0 : s.fsm.sizeKg }));
}

export interface TransferPointView {
  readonly id: number;
  readonly node: number;
  readonly stockKg: number;
  readonly compactorsAssigned: number;
}

export function transferPointViews(world: World): TransferPointView[] {
  const w = ws(world);
  return w.tps.map((tp) => ({
    id: tp.id,
    node: tp.node,
    stockKg: tp.stockKg,
    compactorsAssigned: w.vehicles.filter((v) => v.kind === 'compactor' && v.homeTp === tp.id).length,
  }));
}

/** I-6: what the selected vehicle has left to drive, its whole beat for the day, and what it served or skipped. */
export interface VehiclePlan {
  readonly remainingRoute: readonly number[];
  readonly beatEdges: readonly number[];
  readonly servedSegments: readonly number[];
  readonly skippedSegments: readonly number[];
}

export function vehiclePlan(world: World, id: number): VehiclePlan | null {
  const w = ws(world);
  const v = w.vehicles[id];
  if (!v) return null;
  const place = vehiclePlace(w.traffic, id);
  return {
    remainingRoute: place?.remainingRoute ?? [],
    beatEdges: v.kind === 'auto-tipper' ? (v.walk?.edges ?? []) : [],
    servedSegments: [...v.servedSegs],
    skippedSegments: [...v.skippedSegs],
  };
}

export function worldMap(world: World): MapData {
  return ws(world).map;
}

// --- M2: weather, KPIs, process tracker and tables ----------------------------------------------------------------

const WEATHER_MODES: readonly WeatherMode[] = ['clear', 'monsoon', 'haze', 'heatwave'];

/** Re-plans any vehicle whose remaining route crosses a closed edge (M2-5). */
function rerouteAroundClosures(w: WorldState): void {
  if (w.closed.size === 0) return;
  const g = w.map.graph;
  for (const v of w.vehicles) {
    const place = vehiclePlace(w.traffic, v.id);
    if (!place || place.status === 'arrived') continue;
    const ahead = place.status === 'active' ? place.remainingRoute.slice(1) : place.remainingRoute;
    if (!ahead.some((e) => w.closed.has(e))) continue;
    if (v.kind === 'auto-tipper' && (v.fsm.kind === 'ToBeat' || v.fsm.kind === 'Driving') && v.walk) {
      if (!v.timers.some((tm) => tm.kind === 'dwell')) sendAlongBeat(w, v);
      continue;
    }
    drive(w, v, g.edgeTo[place.remainingRoute[place.remainingRoute.length - 1]!]!);
  }
}

function changeWeather(w: WorldState, mode: WeatherMode): void {
  if (mode === w.weather) return;
  const previous = w.weather;
  w.weather = mode;
  w.speed = applyWeather({ ...w.config.speed, weatherFactor: 1 }, mode);
  // Generation multipliers apply from now on only (M2-4).
  const open = w.weatherSpans.findIndex((sp) => sp.to === OPEN_END);
  if (open >= 0) {
    if (w.weatherSpans[open]!.from >= w.t) w.weatherSpans.splice(open, 1);
    else w.weatherSpans[open]!.to = w.t;
  }
  if (mode === 'monsoon') {
    w.weatherSpans.push({ from: w.t, to: OPEN_END, factor: MONSOON_FACTOR });
    for (const b of w.bins) {
      if (b.sensor.status === 'ok' && keyedChance(w.spec.seed, 'sensor', MONSOON_SENSOR_OFFLINE, b.site.id, w.t, -1)) b.sensor = { status: 'offline', lastReportedPct: b.sensor.lastReportedPct };
    }
    for (const spot of w.map.floodProneSpots) {
      for (const e of spot.edges) w.closed.add(e);
      emit(w, { t: w.t, kind: 'RoadClosed', spotId: spot.id, edges: [...spot.edges] });
    }
    rerouteAroundClosures(w);
    if (w.policy === 'dynamic') {
      const onShift = tippersOnShift(w);
      if (onShift.length > 0) requestPlan(w, 'closure', onShift);
    }
  } else if (previous === 'monsoon') {
    w.closed = new Set();
    for (const spot of w.map.floodProneSpots) emit(w, { t: w.t, kind: 'RoadReopened', spotId: spot.id });
  }
}

/** X-1, M2-4: changes the live weather from the current instant. */
export function setWeather(world: World, mode: WeatherMode): void {
  if (!WEATHER_MODES.includes(mode)) throw new RangeError(`Unknown weather mode: ${mode}`);
  changeWeather(ws(world), mode);
}

export function currentWeather(world: World): WeatherMode {
  return ws(world).weather;
}

/** Edges closed right now (waterlogging), ascending. */
export function closedEdges(world: World): number[] {
  return [...ws(world).closed].sort((a, b) => a - b);
}

function startKpiDay(w: WorldState): void {
  w.today = newDay(dayIndex(w.t));
  for (const v of w.vehicles) v.midnightOdoM = odometerM(w, v);
  w.lineage.pruneBefore(w.t - DAY_SEC);
}

/** Today's KPIs (D-3, M2-1). Accumulators reset at 00:00 IST. */
export interface WorldKpis {
  readonly t: SimTime;
  readonly overflowing: { readonly total: number; readonly binsFull: number; readonly blackSpotsActive: number };
  readonly overflowHoursToday: number;
  readonly fuel: { readonly litresToday: number; readonly tonnesDeliveredToday: number; readonly perTonne: number | null; readonly costInr: number };
  readonly coverage: { readonly pct: number | null; readonly onTime: number; readonly scheduled: number };
  readonly tonnes: { readonly generatedToday: number; readonly collectedToday: number };
}

export function worldKpis(world: World): WorldKpis {
  const w = ws(world);
  const threshold = overflowThreshold(w);
  const binsFull = w.bins.filter((b) => binFillPct(w, b, w.t) >= threshold).length;
  const blackSpotsActive = w.spots.filter((s) => s.fsm.kind !== 'Dormant').length;
  let litres = 0;
  for (const v of w.vehicles) litres += ((odometerM(w, v) - v.midnightOdoM) / 1000) * LITRES_PER_KM[v.kind] * IDLE_ALLOWANCE;
  const tonnes = w.today.deliveredKg / 1000;
  let onTime = 0;
  for (const job of w.today.jobs.values()) if (job.servedAt !== null && job.servedAt >= job.start && job.servedAt <= job.end) onTime++;
  const scheduled = w.today.jobs.size;
  const dayStart = w.today.day * DAY_SEC;
  let generated = 0;
  for (const s of w.segs) generated += genKg(w, s.dailyKg, w.household, dayStart, w.t, 0, s.seg.id);
  for (const b of w.bins) generated += genKg(w, b.site.dailyKg, b.profile, dayStart, w.t, 1, b.site.id);
  return {
    t: w.t,
    overflowing: { total: binsFull + blackSpotsActive, binsFull, blackSpotsActive },
    overflowHoursToday: w.today.overflowHours,
    // M3-12: per tonne collected (it was per tonne delivered until M2).
    fuel: { litresToday: litres, tonnesDeliveredToday: tonnes, perTonne: w.today.collectedKg > 0 ? litres / (w.today.collectedKg / 1000) : null, costInr: litres * w.config.dieselPriceInrPerL },
    coverage: { pct: scheduled > 0 ? (100 * onTime) / scheduled : null, onTime, scheduled },
    tonnes: { generatedToday: generated / 1000, collectedToday: w.today.collectedKg / 1000 },
  };
}

export const TRACKER_STEPS = ['Fill reported', 'Routed', 'Vehicle en route', 'Collected', 'Transferred', 'Processed'] as const;
export type TrackerStep = (typeof TRACKER_STEPS)[number];
/** The six steps in order, each with when it happened (null if not yet). */
export type Timeline = readonly { readonly step: TrackerStep; readonly at: SimTime | null }[];

/** The last 15-minute sensor round at or before t (rounds start at 900 s). */
const lastReadingAtOrBefore = (t: SimTime): SimTime | null => {
  const r = Math.floor(t / SENSOR_PERIOD_SEC) * SENSOR_PERIOD_SEC;
  return r >= SENSOR_PERIOD_SEC ? r : null;
};

function timeline(at: readonly (SimTime | null)[]): Timeline {
  return TRACKER_STEPS.map((step, i) => ({ step, at: at[i] ?? null }));
}

function batchTimeline(w: WorldState, b: Batch | null): Timeline {
  if (!b) return timeline([]);
  const key = `${b.collectedBy}:${dayIndex(b.collectedAt)}`;
  const routed = w.routedAt.get(key) ?? null;
  const enRoute = w.enRouteAt.get(key) ?? null;
  const fill = b.origin.type === 'bin' && routed !== null ? lastReadingAtOrBefore(routed) : null;
  return timeline([fill, routed, enRoute, b.collectedAt, b.transferredAt, b.processedAt]);
}

/** D-5, M2-8: the latest batch from a bin. */
export function binTimeline(world: World, binId: number): Timeline {
  const w = ws(world);
  const batch = w.lineage.latestFor({ type: 'bin', id: binId });
  if (batch) return batchTimeline(w, batch);
  // Not collected yet: show the reading and today's plan for the tipper whose beat includes it.
  const tipper = w.vehicles.find((v): v is TipperRt => v.kind === 'auto-tipper' && [...v.binsAt.values()].some((ids) => ids.includes(binId)));
  const key = tipper ? `${tipper.id}:${dayIndex(w.t)}` : '';
  const routed = w.routedAt.get(key) ?? null;
  return timeline([lastReadingAtOrBefore(routed ?? w.t), routed, w.enRouteAt.get(key) ?? null]);
}

/** The oldest batch waiting at a transfer point (Fill reported to Transferred), or all-null if none. */
export function transferPointTimeline(world: World, tpId: number): Timeline {
  const w = ws(world);
  return batchTimeline(w, w.lineage.waitingAt(tpId)[0] ?? null);
}

/** The oldest batch a vehicle carries, or all-null if empty. */
export function vehicleTimeline(world: World, vehicleId: number): Timeline {
  const w = ws(world);
  return batchTimeline(w, w.lineage.carriedBy(vehicleId)[0] ?? null);
}

/**
 * Today's counts per step: sensor readings, stops planned (beat segments and bins of tippers that started a shift),
 * vehicles on the road now, stops served, tips, unloads.
 */
export function stepCountsToday(world: World): Readonly<Record<TrackerStep, number>> {
  const w = ws(world);
  let planned = 0;
  for (const key of w.today.jobs.keys()) if (!key.startsWith('spot:')) planned++;
  const onRoad = w.vehicles.filter((v) => vehiclePlace(w.traffic, v.id)?.status === 'active').length;
  return {
    'Fill reported': w.today.readings,
    Routed: planned,
    'Vehicle en route': onRoad,
    Collected: w.today.served,
    Transferred: w.today.tips,
    Processed: w.today.unloads,
  };
}

export interface BinRow {
  readonly binId: number;
  readonly kind: BinSite['kind'];
  readonly node: number;
  readonly reportedPct: number | null;
  readonly predictedFullAt: SimTime | null;
  readonly lastServicedAt: SimTime | null;
  readonly sensorStatus: SensorState['status'];
}

export interface FleetRow {
  readonly vehicleId: number;
  readonly kind: VehicleKind;
  readonly state: string;
  readonly loadKg: number;
  readonly fuelLitres: number;
  readonly kmToday: number;
  readonly skippedToday: number;
}

export interface RouteRow {
  readonly vehicleId: number;
  readonly stopsDone: number;
  readonly stopsPlanned: number;
  readonly kmPlanned: number;
  readonly kmActual: number;
  readonly deviations: number;
  /** Estimated beat finish (M2-9), or null when not on a beat today. */
  readonly etaAt: SimTime | null;
  /** M3-D12: the policy now, and today's incident re-plans that changed this route. */
  readonly policy: RoutingPolicy;
  readonly replans: number;
}

/** M2-9 table rows; one per bin, one per vehicle, one per auto-tipper beat. */
export function binRows(world: World): BinRow[] {
  const w = ws(world);
  return w.bins.map((b) => ({
    binId: b.site.id,
    kind: b.site.kind,
    node: b.site.node,
    reportedPct: b.sensor.lastReportedPct,
    predictedFullAt: predictFullAt(b.recent),
    lastServicedAt: b.lastServicedAt,
    sensorStatus: b.sensor.status,
  }));
}

export function fleetRows(world: World): FleetRow[] {
  return vehicleViews(world).map((v) => ({
    vehicleId: v.id,
    kind: v.kind,
    state: v.state,
    loadKg: v.loadKg,
    fuelLitres: v.fuelLitresToday,
    kmToday: v.kmToday,
    skippedToday: v.skippedToday,
  }));
}

const ON_BEAT = new Set(['ToBeat', 'Driving', 'Serving', 'ToTransfer', 'Tipping']);

export function routeRows(world: World): RouteRow[] {
  const w = ws(world);
  const g = w.map.graph;
  const rows: RouteRow[] = [];
  for (const v of w.vehicles) {
    if (v.kind !== 'auto-tipper') continue;
    const walk = v.walk;
    const bins = [...v.binsAt.values()].flat();
    const stopsPlanned = (walk?.order.length ?? 0) + bins.length;
    const stopsDone = v.servedSegs.size + v.servedBins.size;
    let etaAt: SimTime | null = null;
    if (walk && stopsDone < stopsPlanned && ON_BEAT.has(v.fsm.kind) && w.routedAt.has(`${v.id}:${dayIndex(w.t)}`) && v.nextServe < walk.order.length) {
      let metres = 0;
      for (let k = walk.serviceEdgeIndex[v.nextServe]!; k < walk.edges.length; k++) metres += g.edgeLengthM[walk.edges[k]!]!;
      let service = 0;
      for (let i = v.nextServe; i < walk.order.length; i++) {
        const segId = walk.order[i]!;
        if (!v.servedSegs.has(segId) && !v.skippedSegs.has(segId)) service += Math.max(MIN_SERVICE_SEC, SERVICE_SEC_PER_HOUSEHOLD * w.segs[segId]!.seg.households);
      }
      service += bins.filter((b) => !v.servedBins.has(b)).length * BIN_SERVICE_SEC;
      etaAt = Math.round(w.t + metres / ETA_BEAT_SPEED_MPS + service);
    }
    rows.push({
      vehicleId: v.id,
      stopsDone,
      stopsPlanned,
      kmPlanned: (walk?.lengthM ?? 0) / 1000,
      kmActual: (odometerM(w, v) - v.shiftStartOdoM) / 1000,
      deviations: v.deviationsToday,
      etaAt,
      policy: w.policy,
      replans: todaysExplain(w, v.id)?.replans.filter((r) => r.cause !== 'daily').length ?? 0,
    });
  }
  return rows;
}
