/**
 * Dynamic auto-tipper beats (architecture M3-D6): arc routing, warm-started from the static beats. Pure and
 * deterministic: same input, same plan, within an iteration budget (never a wall-clock budget).
 */

/** Why a street is on a route (M3-D10). */
export type PlanReason = 'beat' | 'backlog' | 'fairness' | 'blackSpotRisk';
/**
 * Why a street was deferred: `closed` (unreachable), `lowBacklog` (not must-serve, dropped for higher-priority work
 * when time is short), `capacity` (must-serve, but no tipper had the time; raises a fairness alert).
 */
export type DeferReason = 'capacity' | 'closed' | 'lowBacklog';

/** One street segment to serve. */
export interface ArcTask {
  /** The segment id. */
  readonly id: number;
  /** Midpoint, local metres. */
  readonly x: number;
  readonly y: number;
  readonly serviceSec: number;
  readonly demandKg: number;
  /** Higher is served first (M3-D6 step 2). */
  readonly priority: number;
  /** It would pass 48 h unserved by the end of tomorrow's shift (R-5). */
  readonly mustServe: boolean;
  /** False when road closures cut it off. */
  readonly reachable: boolean;
  readonly reason: PlanReason;
}

export interface ArcVehicle {
  readonly id: number;
  /** Where it starts from (the depot, or where it is for a re-plan). */
  readonly x: number;
  readonly y: number;
  /** Its transfer point. */
  readonly tipX: number;
  readonly tipY: number;
  readonly payloadKg: number;
  /** Already on board (re-plans). */
  readonly loadKg: number;
  /** Seconds left until its shift ends. */
  readonly availableSec: number;
  /** Warm start: the task ids of its usual beat, in walk order. */
  readonly beat: readonly number[];
}

export interface ArcPlanInput {
  readonly tasks: readonly ArcTask[];
  readonly vehicles: readonly ArcVehicle[];
  /** Task ids whose usual tipper is absent or broken down. */
  readonly orphans: readonly number[];
  /** Task id → ids of the tasks it touches (they share a junction). */
  readonly neighbours: ReadonlyMap<number, readonly number[]>;
  readonly speedMps: number;
  /** Straight-line distance × this ≈ road distance. */
  readonly detour: number;
  /** Local-search moves allowed. */
  readonly budget: number;
}

export interface ArcRoute {
  readonly vehicleId: number;
  /** Task ids in service order. */
  readonly tasks: readonly number[];
}

export interface ArcPlan {
  readonly routes: readonly ArcRoute[];
  readonly deferred: readonly { readonly taskId: number; readonly reason: DeferReason }[];
  /** Local-search moves used (≤ budget). */
  readonly iterations: number;
  /** Objective: estimated route seconds plus the priority of deferred work (lower is better). */
  readonly cost: number;
  /** The same objective for the warm start, before local search. */
  readonly warmCost: number;
}

/** Defaults (`assumed`): Euclidean × 1.35 ≈ road distance; tippers average 12 km/h on beats. */
export const DETOUR_FACTOR = 1.35;
export const BEAT_SPEED_MPS = 12 / 3.6;

/** Objective weights: deferring a street costs this many seconds per (1 + priority); a must-serve street far more. */
const DEFER_PENALTY_SEC = 1800;
const MUST_PENALTY_SEC = 100_000;
/** 2-opt only reverses runs of up to this many streets (the walk is local; longer reversals rarely help). */
const TWO_OPT_WINDOW = 12;
/** Candidate tippers for a street with no neighbouring owner: the nearest few by route centre. */
const NEAREST_VEHICLES = 4;
const EPS = 1e-6;

interface Pt {
  readonly x: number;
  readonly y: number;
}

const travel = (input: Pick<ArcPlanInput, 'speedMps' | 'detour'>, a: Pt, b: Pt): number => (Math.hypot(a.x - b.x, a.y - b.y) * input.detour) / input.speedMps;

/**
 * Estimated seconds for a vehicle to serve `tasks` in order: travel (straight line × detour at `speedMps`) from its
 * start through the tasks, service time, and a round trip to its transfer point each time the payload fills, plus
 * the final trip to tip.
 */
export function estimateRouteSec(input: Pick<ArcPlanInput, 'speedMps' | 'detour'>, vehicle: ArcVehicle, tasks: readonly ArcTask[]): number {
  if (tasks.length === 0) return 0;
  const tip = { x: vehicle.tipX, y: vehicle.tipY };
  let sec = 0;
  let pos: Pt = vehicle;
  let load = vehicle.loadKg;
  for (const t of tasks) {
    sec += travel(input, pos, t) + t.serviceSec;
    load += t.demandKg;
    while (load > vehicle.payloadKg && vehicle.payloadKg > 0) {
      sec += 2 * travel(input, t, tip);
      load -= vehicle.payloadKg;
    }
    pos = t;
  }
  return sec + travel(input, pos, tip);
}

const deferPenalty = (t: ArcTask): number => (t.mustServe ? MUST_PENALTY_SEC : 0) + DEFER_PENALTY_SEC * (1 + Math.max(0, t.priority));

/**
 * The plan (M3-D6):
 * 1. streets cut off by closures are deferred as `closed`;
 * 2. each present tipper keeps its usual beat;
 * 3. orphan streets go to the least busy tipper whose beat they border (else the nearest by route centre);
 * 4. each route is trimmed to its tipper's time, lowest priority first; must-serve streets move to a tipper with
 *    time (evicting the fewest low-priority streets if needed), else are deferred as `capacity`;
 * 5. deferred streets are refilled wherever a tipper still has time;
 * 6. local search within the budget: 2-opt inside routes, then boundary streets moved to a neighbouring tipper.
 */
export function planArcs(input: ArcPlanInput): ArcPlan {
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const vehicles = [...input.vehicles].sort((a, b) => a.id - b.id);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const routes = new Map<number, number[]>(vehicles.map((v) => [v.id, []]));
  const owner = new Map<number, number>();
  const deferred = new Map<number, DeferReason>();
  const timeOf = new Map<number, number>();

  const routeOf = (v: ArcVehicle): number[] => routes.get(v.id)!;
  const tasksOf = (ids: readonly number[]): ArcTask[] => ids.map((id) => byId.get(id)!);
  const secOf = (v: ArcVehicle, ids: readonly number[]): number => estimateRouteSec(input, v, tasksOf(ids));
  const timeNow = (v: ArcVehicle): number => timeOf.get(v.id)!;
  const refresh = (v: ArcVehicle): void => {
    timeOf.set(v.id, secOf(v, routeOf(v)));
  };
  const tipOf = (v: ArcVehicle): Pt => ({ x: v.tipX, y: v.tipY });
  /** Cheapest insertion position by local travel change, and that change. */
  const bestPosition = (v: ArcVehicle, route: readonly number[], t: ArcTask): { pos: number; delta: number } => {
    let best = { pos: route.length, delta: Infinity };
    for (let i = 0; i <= route.length; i++) {
      const prev: Pt = i === 0 ? v : byId.get(route[i - 1]!)!;
      const next: Pt = i === route.length ? tipOf(v) : byId.get(route[i]!)!;
      const delta = travel(input, prev, t) + travel(input, t, next) - travel(input, prev, next);
      if (delta < best.delta - EPS) best = { pos: i, delta };
    }
    return best;
  };
  const insert = (v: ArcVehicle, id: number, pos: number): void => {
    routeOf(v).splice(pos, 0, id);
    owner.set(id, v.id);
    deferred.delete(id);
    refresh(v);
  };
  const remove = (v: ArcVehicle, id: number): void => {
    const r = routeOf(v);
    r.splice(r.indexOf(id), 1);
    owner.delete(id);
    refresh(v);
  };
  const centre = (v: ArcVehicle): Pt => {
    const r = routeOf(v);
    if (r.length === 0) return v;
    let x = 0;
    let y = 0;
    for (const id of r) {
      x += byId.get(id)!.x;
      y += byId.get(id)!.y;
    }
    return { x: x / r.length, y: y / r.length };
  };
  const neighbourOwners = (id: number, except: number | null): number[] =>
    [...new Set((input.neighbours.get(id) ?? []).map((n) => owner.get(n)).filter((o): o is number => o !== undefined && o !== except))].sort((a, b) => a - b);
  const nearest = (p: Pt, n: number): ArcVehicle[] =>
    vehicles
      .map((v) => {
        const c = centre(v);
        return { v, d: Math.hypot(c.x - p.x, c.y - p.y) };
      })
      .sort((a, b) => a.d - b.d || a.v.id - b.v.id)
      .slice(0, n)
      .map((x) => x.v);
  /** Tippers worth trying for a street: owners of its neighbours, then the nearest few by route centre. */
  const candidates = (t: ArcTask): ArcVehicle[] => {
    const ids = new Set(neighbourOwners(t.id, null));
    for (const v of nearest(t, NEAREST_VEHICLES)) ids.add(v.id);
    return [...ids].sort((a, b) => a - b).map((id) => vehicleById.get(id)!);
  };
  /** Inserts a street where it fits within a tipper's time at the least extra travel; false if it fits nowhere. */
  const placeFeasible = (t: ArcTask, among: readonly ArcVehicle[]): boolean => {
    let best: { v: ArcVehicle; pos: number; delta: number } | null = null;
    for (const v of among) {
      const route = routeOf(v);
      const { pos, delta } = bestPosition(v, route, t);
      if (best && delta >= best.delta - EPS) continue;
      const trial = [...route.slice(0, pos), t.id, ...route.slice(pos)];
      if (secOf(v, trial) <= v.availableSec) best = { v, pos, delta };
    }
    if (!best) return false;
    insert(best.v, t.id, best.pos);
    return true;
  };
  const deferTask = (t: ArcTask): void => {
    deferred.set(t.id, t.mustServe ? 'capacity' : 'lowBacklog');
  };
  /** A must-serve street: fit it somewhere, evicting the fewest low-priority streets if needed. */
  const placeMust = (t: ArcTask, exclude: number | null): boolean => {
    const among = vehicles.filter((v) => v.id !== exclude);
    if (placeFeasible(t, among)) return true;
    let best: { v: ArcVehicle; route: number[]; evict: number[] } | null = null;
    for (const v of among) {
      const route = routeOf(v);
      const { pos } = bestPosition(v, route, t);
      let trial = [...route.slice(0, pos), t.id, ...route.slice(pos)];
      const evictable = route
        .map((id) => byId.get(id)!)
        .filter((x) => !x.mustServe)
        .sort((a, b) => a.priority - b.priority || b.id - a.id);
      const evict: number[] = [];
      while (secOf(v, trial) > v.availableSec && evict.length < evictable.length) {
        const e = evictable[evict.length]!;
        evict.push(e.id);
        trial = trial.filter((id) => id !== e.id);
      }
      if (secOf(v, trial) > v.availableSec) continue;
      if (!best || evict.length < best.evict.length) best = { v, route: trial, evict };
    }
    if (!best) return false;
    for (const id of best.evict) {
      owner.delete(id);
      deferTask(byId.get(id)!);
    }
    routeOf(best.v).splice(0, routeOf(best.v).length, ...best.route);
    owner.set(t.id, best.v.id);
    deferred.delete(t.id);
    refresh(best.v);
    return true;
  };

  // 1. Streets cut off by closures.
  for (const t of [...input.tasks].sort((a, b) => a.id - b.id)) if (!t.reachable) deferred.set(t.id, 'closed');

  // 2. Warm start: each present tipper keeps its usual beat.
  for (const v of vehicles) {
    const route = routeOf(v);
    for (const id of v.beat) {
      const t = byId.get(id);
      if (!t?.reachable || owner.has(id)) continue;
      route.push(id);
      owner.set(id, v.id);
    }
    refresh(v);
  }

  // 3. Orphans (and any other unowned street) go to the least busy tipper whose beat they border.
  let pending = input.tasks.filter((t) => t.reachable && !owner.has(t.id)).sort((a, b) => a.id - b.id);
  for (let progress = true; progress && pending.length > 0; ) {
    progress = false;
    const rest: ArcTask[] = [];
    for (const t of pending) {
      const owners = neighbourOwners(t.id, null);
      if (owners.length === 0) {
        rest.push(t);
        continue;
      }
      const v = owners.map((id) => vehicleById.get(id)!).sort((a, b) => timeNow(a) - timeNow(b) || a.id - b.id)[0]!;
      insert(v, t.id, bestPosition(v, routeOf(v), t).pos);
      progress = true;
    }
    pending = rest;
  }
  for (const t of pending) {
    const v = nearest(t, 1)[0];
    if (v) insert(v, t.id, bestPosition(v, routeOf(v), t).pos);
    else deferTask(t);
  }

  // 4. Trim each route to its tipper's time.
  for (const v of vehicles) {
    while (timeNow(v) > v.availableSec) {
      const route = routeOf(v);
      const loose = route.map((id) => byId.get(id)!).filter((t) => !t.mustServe);
      if (loose.length > 0) {
        const drop = loose.reduce((a, b) => (b.priority < a.priority || (b.priority === a.priority && b.id > a.id) ? b : a));
        remove(v, drop.id);
        deferTask(drop);
        continue;
      }
      // Only must-serve streets left: move the one whose removal saves most.
      let worst = route[0]!;
      let saving = -Infinity;
      for (const id of route) {
        const s = timeNow(v) - secOf(
          v,
          route.filter((x) => x !== id),
        );
        if (s > saving + EPS) {
          saving = s;
          worst = id;
        }
      }
      remove(v, worst);
      if (!placeMust(byId.get(worst)!, v.id)) deferTask(byId.get(worst)!);
    }
  }

  // 5. Refill: nothing is deferred while some tipper has time for it (must-serve first, then by priority).
  const waiting = [...deferred.entries()]
    .filter(([, reason]) => reason !== 'closed')
    .map(([id]) => byId.get(id)!)
    .sort((a, b) => Number(b.mustServe) - Number(a.mustServe) || b.priority - a.priority || a.id - b.id);
  for (const t of waiting) {
    if (!deferred.has(t.id)) continue;
    if (placeFeasible(t, candidates(t)) || placeFeasible(t, vehicles)) continue;
    if (t.mustServe) placeMust(t, null);
  }

  const cost = (): number => {
    let c = 0;
    for (const v of vehicles) c += timeNow(v);
    for (const [id, reason] of deferred) if (reason !== 'closed') c += deferPenalty(byId.get(id)!);
    return c;
  };
  const warmCost = cost();

  // 6. Local search within the budget.
  let iterations = 0;
  const budget = Math.max(0, Math.floor(input.budget));
  for (let improved = true; improved && iterations < budget; ) {
    improved = false;
    for (const v of vehicles) {
      const route = routeOf(v);
      for (let i = 0; i + 1 < route.length && iterations < budget; i++) {
        for (let j = i + 1; j < Math.min(route.length, i + 1 + TWO_OPT_WINDOW) && iterations < budget; j++) {
          iterations++;
          const prev: Pt = i === 0 ? v : byId.get(route[i - 1]!)!;
          const next: Pt = j === route.length - 1 ? tipOf(v) : byId.get(route[j + 1]!)!;
          const a = byId.get(route[i]!)!;
          const b = byId.get(route[j]!)!;
          if (travel(input, prev, b) + travel(input, a, next) - travel(input, prev, a) - travel(input, b, next) >= -EPS) continue;
          const trial = [...route.slice(0, i), ...route.slice(i, j + 1).reverse(), ...route.slice(j + 1)];
          const sec = secOf(v, trial);
          if (sec < timeNow(v) - EPS && sec <= v.availableSec) {
            route.splice(0, route.length, ...trial);
            timeOf.set(v.id, sec);
            improved = true;
          }
        }
      }
    }
    for (const v of vehicles) {
      for (const id of [...routeOf(v)]) {
        if (iterations >= budget) break;
        if (owner.get(id) !== v.id) continue;
        const t = byId.get(id)!;
        for (const wid of neighbourOwners(id, v.id)) {
          if (iterations >= budget) break;
          iterations++;
          const w = vehicleById.get(wid)!;
          const without = routeOf(v).filter((x) => x !== id);
          const wRoute = routeOf(w);
          const { pos } = bestPosition(w, wRoute, t);
          const withIt = [...wRoute.slice(0, pos), id, ...wRoute.slice(pos)];
          const sv = secOf(v, without);
          const sw = secOf(w, withIt);
          if (sw <= w.availableSec && sv + sw < timeNow(v) + timeNow(w) - EPS) {
            routeOf(v).splice(0, routeOf(v).length, ...without);
            wRoute.splice(0, wRoute.length, ...withIt);
            owner.set(id, w.id);
            timeOf.set(v.id, sv);
            timeOf.set(w.id, sw);
            improved = true;
            break;
          }
        }
      }
    }
  }

  return {
    routes: vehicles.map((v) => ({ vehicleId: v.id, tasks: [...routeOf(v)] })),
    deferred: [...deferred.entries()].sort((a, b) => a[0] - b[0]).map(([taskId, reason]) => ({ taskId, reason })),
    iterations,
    cost: cost(),
    warmCost,
  };
}

/**
 * Problems with a plan, or an empty list: unknown vehicles or tasks, a task served twice, a task neither served
 * nor deferred, a route over its vehicle's time, or a deferral whose reason does not match the task (`closed` for
 * unreachable, else `capacity` for must-serve and `lowBacklog` for the rest).
 */
export function validateArcPlan(input: ArcPlanInput, plan: ArcPlan): string[] {
  const problems: string[] = [];
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const vehicleById = new Map(input.vehicles.map((v) => [v.id, v]));
  const seen = new Map<number, 'served' | 'deferred'>();
  for (const r of plan.routes) {
    const v = vehicleById.get(r.vehicleId);
    if (!v) problems.push(`vehicle ${r.vehicleId} is not a present tipper`);
    for (const id of r.tasks) {
      const t = byId.get(id);
      if (!t) problems.push(`task ${id} on vehicle ${r.vehicleId} is unknown`);
      else if (!t.reachable) problems.push(`task ${id} is unreachable but on vehicle ${r.vehicleId}`);
      if (seen.has(id)) problems.push(`task ${id} is served twice`);
      seen.set(id, 'served');
    }
    if (v) {
      const sec = estimateRouteSec(
        input,
        v,
        r.tasks.flatMap((id) => byId.get(id) ?? []),
      );
      if (sec > v.availableSec + EPS) problems.push(`vehicle ${v.id} route takes ${sec.toFixed(0)} s, over its time of ${v.availableSec.toFixed(0)} s`);
    }
  }
  for (const d of plan.deferred) {
    const t = byId.get(d.taskId);
    if (!t) {
      problems.push(`deferred task ${d.taskId} is unknown`);
      continue;
    }
    const before = seen.get(d.taskId);
    if (before) problems.push(`task ${d.taskId} is ${before === 'served' ? 'both served and deferred' : 'deferred twice'}`);
    seen.set(d.taskId, 'deferred');
    const expected: DeferReason = !t.reachable ? 'closed' : t.mustServe ? 'capacity' : 'lowBacklog';
    if (d.reason !== expected) problems.push(`task ${d.taskId} is deferred as ${d.reason}, expected ${expected}`);
  }
  for (const t of input.tasks) if (!seen.has(t.id)) problems.push(`task ${t.id} is missing (neither served nor deferred)`);
  return problems;
}
