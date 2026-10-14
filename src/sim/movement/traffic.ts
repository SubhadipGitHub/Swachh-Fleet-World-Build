import type { RoadGraph } from '../../routing/graph';
import type { SimTime } from '../clock';

/** Fleet movement on lane queues (AD-6). */
export interface TrafficParams {
  /** Minimum clear gap between a vehicle's front and the leader's rear (m). */
  readonly minGapM: number;
  /** Seconds a vehicle waits behind a stopped service vehicle on a two-way street before passing it. */
  readonly passDelaySec: number;
  readonly maxAccelMps2: number;
  readonly maxDecelMps2: number;
}

export const DEFAULT_TRAFFIC_PARAMS: TrafficParams = { minGapM: 2, passDelaySec: 3, maxAccelMps2: 1.5, maxDecelMps2: 3 };

export interface TrafficVehicle {
  readonly id: number;
  readonly lengthM: number;
  /** Directed edges to drive, consecutive edges connected. */
  readonly route: readonly number[];
  readonly departAt: SimTime;
}

/** A place on a route where the vehicle halts until `resume` is called (a service stop). */
export interface RouteStop {
  readonly routeIdx: number;
  /** Front position on that edge (m), clamped to the edge. */
  readonly s: number;
  readonly tag: number;
}

export interface VehiclePosition {
  readonly id: number;
  readonly edge: number;
  readonly lane: number;
  /** Distance of the vehicle's front from the edge's start node (m). */
  readonly s: number;
  readonly speedMps: number;
}

export type TrafficEvent =
  | { readonly kind: 'Departed'; readonly id: number; readonly t: SimTime }
  | { readonly kind: 'Arrived'; readonly id: number; readonly t: SimTime }
  | { readonly kind: 'ReachedStop'; readonly id: number; readonly tag: number; readonly t: SimTime };

/** Speed limit for an edge at a time (m/s), from the speed model. */
export type SpeedLimitFn = (edge: number, t: SimTime) => number;

interface Mover {
  readonly id: number;
  readonly lengthM: number;
  route: readonly number[];
  departAt: SimTime;
  /** waiting: due to enter; active: on a lane; arrived: parked at the end node of its last route. */
  status: 'waiting' | 'active' | 'arrived';
  routeIdx: number;
  lane: number;
  s: number;
  speed: number;
  /** Held in place by setStopped (e.g. a breakdown). */
  held: boolean;
  /** Halted at the first stop in `stops`. */
  atStop: boolean;
  stops: RouteStop[];
  /** Seconds spent blocked directly behind a stopped vehicle. */
  blockedBehindStopped: number;
  /** Junctions this vehicle still occupies, with the distance left until its rear clears each. */
  junctions: { node: number; remaining: number }[];
  /** Metres driven since the vehicle was added. */
  odometerM: number;
}

/** Opaque traffic state. */
export interface Traffic {
  readonly graph: RoadGraph;
}

interface TrafficState extends Traffic {
  readonly speedLimit: SpeedLimitFn;
  readonly params: TrafficParams;
  readonly movers: Map<number, Mover>;
  /** Lane queues keyed by edge × 16 + lane, leader (largest s) first. */
  readonly lanes: Map<number, number[]>;
  /** Sorted lane keys, rebuilt only when a lane appears or empties. */
  laneKeys: number[];
  laneKeysDirty: boolean;
  readonly reserved: Map<number, number>;
  /** Waiting movers in id order. */
  waiting: Mover[];
  activeCount: number;
}

const laneKey = (edge: number, lane: number): number => edge * 16 + lane;
const state = (tr: Traffic): TrafficState => tr as TrafficState;
const isStopped = (m: Mover): boolean => m.held || m.atStop;

export function createTraffic(g: RoadGraph, speedLimit: SpeedLimitFn, params: TrafficParams = DEFAULT_TRAFFIC_PARAMS): Traffic {
  const tr: TrafficState = {
    graph: g,
    speedLimit,
    params,
    movers: new Map(),
    lanes: new Map(),
    laneKeys: [],
    laneKeysDirty: false,
    reserved: new Map(),
    waiting: [],
    activeCount: 0,
  };
  return tr;
}

function checkRoute(g: RoadGraph, id: number, route: readonly number[]): void {
  if (route.length === 0) throw new Error(`Vehicle ${id} has an empty route`);
  for (let i = 1; i < route.length; i++) {
    if (g.edgeFrom[route[i]!] !== g.edgeTo[route[i - 1]!]) throw new Error(`Vehicle ${id} route is disconnected at step ${i}`);
  }
}

function sortStops(stops: readonly RouteStop[]): RouteStop[] {
  return [...stops].sort((a, b) => a.routeIdx - b.routeIdx || a.s - b.s);
}

function enqueueWaiting(st: TrafficState, m: Mover): void {
  m.status = 'waiting';
  let i = st.waiting.length;
  while (i > 0 && st.waiting[i - 1]!.id > m.id) i--;
  st.waiting.splice(i, 0, m);
}

/** Throws if the id exists or the route is empty or disconnected. */
export function addVehicle(tr: Traffic, v: TrafficVehicle, stops: readonly RouteStop[] = []): void {
  const st = state(tr);
  if (st.movers.has(v.id)) throw new Error(`Vehicle ${v.id} already exists`);
  checkRoute(st.graph, v.id, v.route);
  const m: Mover = {
    id: v.id,
    lengthM: v.lengthM,
    route: v.route,
    departAt: v.departAt,
    status: 'waiting',
    routeIdx: 0,
    lane: 0,
    s: 0,
    speed: 0,
    held: false,
    atStop: false,
    stops: sortStops(stops),
    blockedBehindStopped: 0,
    junctions: [],
    odometerM: 0,
  };
  st.movers.set(v.id, m);
  enqueueWaiting(st, m);
}

/** Replaces an active vehicle's remaining route. route[0] must be its current edge; it keeps its position. */
export function reroute(tr: Traffic, id: number, route: readonly number[], stops: readonly RouteStop[] = []): void {
  const st = state(tr);
  const m = st.movers.get(id);
  if (!m || m.status !== 'active') throw new Error(`Vehicle ${id} is not on the network`);
  if (route[0] !== m.route[m.routeIdx]) throw new Error(`Vehicle ${id}: a new route must start on the current edge`);
  checkRoute(st.graph, id, route);
  m.route = route;
  m.routeIdx = 0;
  m.atStop = false;
  m.stops = sortStops(stops);
}

/** Releases a vehicle halted at its current stop. */
export function resume(tr: Traffic, id: number): void {
  const m = state(tr).movers.get(id);
  if (!m) throw new Error(`Unknown vehicle ${id}`);
  if (m.atStop) {
    m.stops.shift();
    m.atStop = false;
  }
}

/** Marks a vehicle as stopped for service (it holds its position) or releases it. */
export function setStopped(tr: Traffic, id: number, stopped: boolean): void {
  const m = state(tr).movers.get(id);
  if (!m) throw new Error(`Unknown vehicle ${id}`);
  m.held = stopped;
}

/** Lane on `edge` whose tail leaves the most room at the start, or −1 if none has `need` metres. */
function laneWithRoom(st: TrafficState, edge: number, need: number): number {
  const lanes = st.graph.edgeLanes[edge]!;
  let best = -1;
  let bestRoom = -Infinity;
  for (let lane = 0; lane < lanes; lane++) {
    const q = st.lanes.get(laneKey(edge, lane));
    let room = st.graph.edgeLengthM[edge]!;
    if (q && q.length > 0) {
      const tail = st.movers.get(q[q.length - 1]!)!;
      room = tail.s - tail.lengthM - st.params.minGapM;
    }
    if (room >= need && room > bestRoom) {
      best = lane;
      bestRoom = room;
    }
  }
  return best;
}

function dropLaneIfEmpty(st: TrafficState, key: number, q: number[]): void {
  if (q.length === 0) {
    st.lanes.delete(key);
    st.laneKeysDirty = true;
  }
}

function removeFromLane(st: TrafficState, m: Mover): void {
  const key = laneKey(m.route[m.routeIdx]!, m.lane);
  const q = st.lanes.get(key);
  if (!q) return;
  const i = q.indexOf(m.id);
  if (i >= 0) q.splice(i, 1);
  dropLaneIfEmpty(st, key, q);
}

function appendToLane(st: TrafficState, m: Mover, edge: number, lane: number): void {
  const key = laneKey(edge, lane);
  const q = st.lanes.get(key);
  if (q) q.push(m.id);
  else {
    st.lanes.set(key, [m.id]);
    st.laneKeysDirty = true;
  }
}

function clearJunctions(st: TrafficState, m: Mover, distance: number): void {
  if (m.junctions.length === 0 || distance <= 0) return;
  let keep = 0;
  for (const h of m.junctions) {
    h.remaining -= distance;
    if (h.remaining > 0) m.junctions[keep++] = h;
    else if (st.reserved.get(h.node) === m.id) st.reserved.delete(h.node);
  }
  m.junctions.length = keep;
}

function releaseAllJunctions(st: TrafficState, m: Mover): void {
  for (const h of m.junctions) if (st.reserved.get(h.node) === m.id) st.reserved.delete(h.node);
  m.junctions.length = 0;
}

/** Room needed on the next edge before entering: the whole vehicle plus a gap, or an empty lane on a short edge. */
function entryNeed(st: TrafficState, m: Mover, edge: number): number {
  return Math.min(m.lengthM + st.params.minGapM, st.graph.edgeLengthM[edge]!);
}

/** Moves the vehicle to `ns` on its edge, halting at a stop on the way. Returns the events raised. */
function advanceTo(st: TrafficState, m: Mover, ns: number, dtSec: number, now: SimTime, events: TrafficEvent[]): void {
  const stop = m.stops[0];
  let target = ns;
  if (stop && stop.routeIdx === m.routeIdx && target >= stop.s) target = Math.max(m.s, Math.min(target, stop.s));
  clearJunctions(st, m, target - m.s);
  m.odometerM += target - m.s;
  m.speed = (target - m.s) / dtSec;
  m.s = target;
  if (stop && stop.routeIdx === m.routeIdx && m.s >= Math.min(stop.s, st.graph.edgeLengthM[m.route[m.routeIdx]!]!) - 1e-9) {
    m.atStop = true;
    m.speed = 0;
    events.push({ kind: 'ReachedStop', id: m.id, tag: stop.tag, t: now });
  }
}

/** Tries to overtake a stopped leader on a two-way street or change lanes. Returns true if the vehicle moved. */
function tryPass(st: TrafficState, m: Mover, leader: Mover, q: number[], idx: number): boolean {
  const g = st.graph;
  const edge = m.route[m.routeIdx]!;
  const gap = st.params.minGapM;
  for (let lane = 0; lane < g.edgeLanes[edge]!; lane++) {
    if (lane === m.lane) continue;
    const other = st.lanes.get(laneKey(edge, lane)) ?? [];
    const ok = other.every((id) => {
      const o = st.movers.get(id)!;
      return o.s >= m.s ? m.s <= o.s - o.lengthM - gap : o.s <= m.s - m.lengthM - gap;
    });
    if (!ok) continue;
    q.splice(idx, 1);
    dropLaneIfEmpty(st, laneKey(edge, m.lane), q);
    const key = laneKey(edge, lane);
    const target = st.lanes.get(key) ?? [];
    target.push(m.id);
    target.sort((a, b) => st.movers.get(b)!.s - st.movers.get(a)!.s);
    if (!st.lanes.has(key)) {
      st.lanes.set(key, target);
      st.laneKeysDirty = true;
    }
    m.lane = lane;
    return true;
  }
  if (g.edgeTwin[edge]! < 0) return false;
  const newS = leader.s + m.lengthM + gap;
  if (newS > g.edgeLengthM[edge]!) return false;
  const stop = m.stops[0];
  if (stop && stop.routeIdx === m.routeIdx && stop.s < newS) return false;
  const ahead = idx >= 2 ? st.movers.get(q[idx - 2]!)! : null;
  if (ahead && newS > ahead.s - ahead.lengthM - gap) return false;
  q.splice(idx, 1);
  q.splice(idx - 1, 0, m.id);
  clearJunctions(st, m, newS - m.s);
  m.s = newS;
  return true;
}

/**
 * Advances from t to t + dtSec. Invariants: on any edge lane, follower front ≤ leader front − leader length −
 * minGapM; each junction is reserved by at most one vehicle at a time; a vehicle enters an edge only if its tail has
 * room. Vehicles that have not departed or have arrived are not on the network.
 */
export function stepTraffic(tr: Traffic, t: SimTime, dtSec: number): TrafficEvent[] {
  const st = state(tr);
  const g = st.graph;
  const { minGapM, maxAccelMps2, passDelaySec } = st.params;
  const now = t + dtSec;
  const events: TrafficEvent[] = [];

  // Departures, in id order, when the first edge has room.
  if (st.waiting.length > 0) {
    for (let i = 0; i < st.waiting.length; i++) {
      const m = st.waiting[i]!;
      if (m.departAt > now) continue;
      const edge = m.route[0]!;
      const lane = laneWithRoom(st, edge, entryNeed(st, m, edge));
      if (lane < 0) continue;
      st.waiting.splice(i--, 1);
      m.status = 'active';
      st.activeCount++;
      m.lane = lane;
      m.s = 0;
      m.speed = 0;
      appendToLane(st, m, edge, lane);
      events.push({ kind: 'Departed', id: m.id, t: now });
      advanceTo(st, m, 0, dtSec, now, events);
    }
  }
  if (st.activeCount === 0) return events;

  // Movement, lane by lane in edge order, leaders first. Each vehicle moves at most once per step.
  if (st.laneKeysDirty) {
    st.laneKeys = [...st.lanes.keys()].sort((a, b) => a - b);
    st.laneKeysDirty = false;
  }
  const moved = new Set<number>();
  for (const key of st.laneKeys) {
    const q = st.lanes.get(key);
    if (!q) continue;
    for (let idx = 0; idx < q.length; idx++) {
      const m = st.movers.get(q[idx]!)!;
      if (moved.has(m.id)) continue;
      moved.add(m.id);
      if (isStopped(m)) {
        m.speed = 0;
        continue;
      }
      const edge = m.route[m.routeIdx]!;
      const len = g.edgeLengthM[edge]!;
      const leader = idx > 0 ? st.movers.get(q[idx - 1]!)! : null;

      // Waiting behind a stopped vehicle: pass after the delay if the street allows.
      if (leader && isStopped(leader) && leader.s - leader.lengthM - minGapM - m.s < 0.5) {
        m.blockedBehindStopped += dtSec;
        if (m.blockedBehindStopped >= passDelaySec && tryPass(st, m, leader, q, idx)) {
          m.blockedBehindStopped = 0;
          idx--;
        }
        m.speed = 0;
        continue;
      }
      m.blockedBehindStopped = 0;

      const v = Math.min(st.speedLimit(edge, t), m.speed + maxAccelMps2 * dtSec);
      let target = m.s + v * dtSec;
      if (leader) target = Math.min(target, leader.s - leader.lengthM - minGapM);
      const stop = m.stops[0];
      const stopHere = stop !== undefined && stop.routeIdx === m.routeIdx;
      if (target < len || leader || stopHere) {
        advanceTo(st, m, Math.max(m.s, Math.min(target, len)), dtSec, now, events);
        continue;
      }

      const last = m.routeIdx === m.route.length - 1;
      if (last) {
        clearJunctions(st, m, len - m.s);
        m.odometerM += len - m.s;
        releaseAllJunctions(st, m);
        q.splice(idx--, 1);
        dropLaneIfEmpty(st, key, q);
        m.status = 'arrived';
        st.activeCount--;
        m.s = len;
        m.speed = 0;
        events.push({ kind: 'Arrived', id: m.id, t: now });
        continue;
      }
      const node = g.edgeTo[edge]!;
      const next = m.route[m.routeIdx + 1]!;
      const holder = st.reserved.get(node);
      const lane = holder === undefined || holder === m.id ? laneWithRoom(st, next, entryNeed(st, m, next)) : -1;
      if (lane < 0) {
        advanceTo(st, m, len, dtSec, now, events);
        continue;
      }
      // Cross the junction: hold it until the rear has cleared, then carry on into the next edge.
      const overflow = Math.min(target - len, entryNeed(st, m, next) - minGapM);
      clearJunctions(st, m, len - m.s);
      m.odometerM += len - m.s;
      st.reserved.set(node, m.id);
      m.junctions.push({ node, remaining: m.lengthM });
      q.splice(idx--, 1);
      dropLaneIfEmpty(st, key, q);
      m.routeIdx++;
      m.lane = lane;
      m.s = 0;
      m.speed = v;
      appendToLane(st, m, next, lane);
      advanceTo(st, m, Math.max(0, overflow), dtSec, now, events);
      m.speed = v;
    }
  }
  return events;
}

export function positions(tr: Traffic): VehiclePosition[] {
  const st = state(tr);
  return [...st.movers.values()]
    .filter((m) => m.status === 'active')
    .sort((a, b) => a.id - b.id)
    .map((m) => ({ id: m.id, edge: m.route[m.routeIdx]!, lane: m.lane, s: m.s, speedMps: m.speed }));
}

/** One vehicle's place: on an edge (active), or parked at the end of its last route (arrived) or waiting to enter. */
export function vehiclePlace(tr: Traffic, id: number): { readonly status: 'waiting' | 'active' | 'arrived'; readonly edge: number; readonly s: number; readonly speedMps: number; readonly lane: number; readonly odometerM: number; readonly remainingRoute: readonly number[] } | null {
  const m = state(tr).movers.get(id);
  if (!m) return null;
  return { status: m.status, edge: m.route[m.routeIdx]!, s: m.s, speedMps: m.speed, lane: m.lane, odometerM: m.odometerM, remainingRoute: m.status === 'arrived' ? [] : m.route.slice(m.routeIdx) };
}

/** True when no vehicle is on the network or due to enter it by `t`. */
export function isIdle(tr: Traffic, t: SimTime): boolean {
  const st = state(tr);
  return st.activeCount === 0 && !st.waiting.some((m) => m.departAt <= t);
}

/** Current junction reservations (graph node → vehicle id). */
export function reservations(tr: Traffic): ReadonlyMap<number, number> {
  return new Map(state(tr).reserved);
}

/** Removes a vehicle wherever it is (e.g. a breakdown towed away), releasing its lane and junctions. */
export function removeVehicle(tr: Traffic, id: number): void {
  const st = state(tr);
  const m = st.movers.get(id);
  if (!m) return;
  if (m.status === 'active') {
    removeFromLane(st, m);
    st.activeCount--;
  }
  if (m.status === 'waiting') st.waiting.splice(st.waiting.indexOf(m), 1);
  releaseAllJunctions(st, m);
  st.movers.delete(id);
}
