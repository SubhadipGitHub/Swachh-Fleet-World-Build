import { BEAT_SPEED_MPS, DETOUR_FACTOR, planArcs, type ArcTask, type ArcVehicle, type PlanReason } from '../../routing/vrp/beats-dynamic';
import { DAY_SEC } from '../clock';
import { RateLearner, segmentBacklogKg, type Confidence } from '../forecast';
import { DEFAULT_PRIORITY_WEIGHTS, type DayPlan, type Deferral, type PlannedStop, type PlanRequest } from './types';

/** Fairness guard (R-5): no street may go longer than this unserved. */
const FAIRNESS_SEC = 48 * 3600;
/** A street holding more than this many days of waste is on the route for its backlog. */
const BACKLOG_DAYS = 1.2;
/** Black-spot risk of a street feeding an active spot, and a dormant one. */
const RISK_ACTIVE = 1;
const RISK_DORMANT = 0.3;
/** r̂ is trusted (confidence `normal`) after this many days of weigh-ins. */
const DAYS_FOR_CONFIDENCE = 2;

/**
 * The Dynamic tipper plan (architecture M3-D5, M3-D6): forecasts from the operator view, street priorities with the
 * 48 h fairness guard, then `planArcs`. Pure, so the solver worker, the inline host, `skipTo` and the tests all get
 * the same plan for the same request.
 */
export function planDynamic(req: PlanRequest): DayPlan {
  const { view, map } = req;
  const dayStart = view.day * DAY_SEC;
  // r̂ from the weighbridge, learned day by day (surges are learned, not given).
  const rHat = new RateLearner(map.rPrior);
  let learnedDays = 0;
  for (let d = 0; d < view.day; d++) {
    const kg = view.weighedKgByDay[d] ?? 0;
    const hd = view.householdDaysByDay[d] ?? 0;
    if (kg > 0 && hd > 0) learnedDays++;
    rHat.update(kg, hd);
  }
  const r = rHat.value();
  const confidence: Confidence = learnedDays >= DAYS_FOR_CONFIDENCE ? 'normal' : 'low';
  const closed = new Set(view.closedSegments);
  const [shiftStartSod, shiftEndSod] = map.tipperShift;
  // Forecast for the middle of today's shift, or now for a later re-plan.
  const at = Math.max(req.dueAt, dayStart + (shiftStartSod + shiftEndSod) / 2);
  const tomorrowShiftEnd = dayStart + DAY_SEC + shiftEndSod;
  const risk = new Map<number, number>();
  map.spotSegments.forEach((segs, spotId) => {
    const active = view.spots[spotId]?.sizeKg !== null && view.spots[spotId] !== undefined;
    for (const s of segs) risk.set(s, Math.max(risk.get(s) ?? 0, active ? RISK_ACTIVE : RISK_DORMANT));
  });

  const w = DEFAULT_PRIORITY_WEIGHTS;
  const meta = new Map<number, { stop: PlannedStop; mustServe: boolean }>();
  const taskOf = (seg: (typeof map.segments)[number]): ArcTask => {
    const last = view.segmentsLastServedAt[seg.id] ?? 0;
    const predictedKg = segmentBacklogKg(seg.households, r, last, at, map.householdProfile);
    const dayKg = Math.max(1e-9, seg.households * r);
    const hoursSinceServed = Math.max(0, (req.dueAt - last) / 3600);
    const mustServe = tomorrowShiftEnd - last > FAIRNESS_SEC;
    const segRisk = risk.get(seg.id) ?? 0;
    const priority = w.backlog * (predictedKg / dayKg) + w.age * (hoursSinceServed / 24) + w.risk * segRisk;
    const reason: PlanReason = mustServe ? 'fairness' : segRisk >= RISK_ACTIVE ? 'blackSpotRisk' : predictedKg > BACKLOG_DAYS * dayKg ? 'backlog' : 'beat';
    meta.set(seg.id, { stop: { segmentId: seg.id, reason, predictedKg, hoursSinceServed, confidence }, mustServe });
    return { id: seg.id, x: seg.x, y: seg.y, serviceSec: seg.serviceSec, demandKg: predictedKg, priority, mustServe, reachable: !closed.has(seg.id), reason };
  };

  const segById = new Map(map.segments.map((s) => [s.id, s]));
  const daily = req.cause === 'daily';
  const rosterById = new Map(view.roster.map((x) => [x.id, x]));
  const remainingOf = new Map(view.assignments.map((a) => [a.tipperId, a.remaining]));
  // 0 means never served, so "today" is strictly after midnight.
  const servedToday = (id: number): boolean => (view.segmentsLastServedAt[id] ?? 0) > dayStart;

  // Streets in play: every street for the daily plan; the affected tippers' remaining streets for a re-plan.
  const taskIds = daily ? map.segments.map((s) => s.id) : [...new Set(req.vehicleIds.flatMap((id) => remainingOf.get(id) ?? []))].filter((id) => !servedToday(id));
  const tasks = taskIds.flatMap((id) => {
    const seg = segById.get(id);
    return seg ? [taskOf(seg)] : [];
  });
  const inPlay = new Set(tasks.map((t) => t.id));

  const vehicles: ArcVehicle[] = [];
  for (const id of req.vehicleIds) {
    const r0 = rosterById.get(id);
    if (!r0 || r0.kind !== 'auto-tipper' || !r0.present || r0.brokenDown) continue;
    const tp = map.transferPoints[r0.tp] ?? map.transferPoints[0] ?? map.depot;
    const beat = daily ? (map.beats.find((b) => b.tipperId === id)?.segments ?? []) : (remainingOf.get(id) ?? []);
    const from = daily ? map.depot : { x: r0.x, y: r0.y };
    vehicles.push({
      id,
      x: from.x,
      y: from.y,
      tipX: tp.x,
      tipY: tp.y,
      payloadKg: map.tipperPayloadKg,
      loadKg: 0,
      availableSec: Math.max(0, r0.shiftEnd - Math.max(r0.shiftStart, req.dueAt)),
      beat: beat.filter((s) => inPlay.has(s)),
    });
  }
  const owned = new Set(vehicles.flatMap((v) => v.beat));
  const neighbours = new Map(map.segments.map((s) => [s.id, s.neighbours]));
  const plan = planArcs({
    tasks,
    vehicles,
    orphans: tasks.filter((t) => !owned.has(t.id)).map((t) => t.id),
    neighbours,
    speedMps: BEAT_SPEED_MPS,
    detour: DETOUR_FACTOR,
    budget: req.budget,
  });
  const routes = req.vehicleIds.map((vehicleId) => ({
    vehicleId,
    stops: (plan.routes.find((r) => r.vehicleId === vehicleId)?.tasks ?? []).map((id) => meta.get(id)!.stop),
  }));
  const deferred: Deferral[] = plan.deferred.map((d) => ({ segmentId: d.taskId, reason: d.reason, mustServe: meta.get(d.taskId)?.mustServe ?? false }));
  return { reqId: req.reqId, routes, deferred, iterations: plan.iterations };
}

/**
 * Problems with a plan for a request, or an empty list (M3-D9 validation before use): the request id; routes only
 * for the request's tippers, with streets only for those present and running; known streets; none planned twice or
 * both planned and deferred.
 */
export function validatePlan(req: PlanRequest, plan: DayPlan): string[] {
  const problems: string[] = [];
  if (plan.reqId !== req.reqId) problems.push(`plan ${plan.reqId} answers request ${req.reqId}`);
  const known = new Set(req.map.segments.map((s) => s.id));
  const roster = new Map(req.view.roster.map((r) => [r.id, r]));
  const asked = new Set(req.vehicleIds);
  const seen = new Set<number>();
  for (const route of plan.routes) {
    if (!asked.has(route.vehicleId)) problems.push(`vehicle ${route.vehicleId} was not part of the request`);
    const r = roster.get(route.vehicleId);
    if (route.stops.length > 0 && (!r || !r.present || r.brokenDown)) problems.push(`vehicle ${route.vehicleId} cannot run a route now`);
    for (const st of route.stops) {
      if (!known.has(st.segmentId)) problems.push(`segment ${st.segmentId} is not a served street`);
      if (seen.has(st.segmentId)) problems.push(`segment ${st.segmentId} is planned twice`);
      seen.add(st.segmentId);
    }
  }
  for (const d of plan.deferred) {
    if (!known.has(d.segmentId)) problems.push(`deferred segment ${d.segmentId} is not a served street`);
    if (seen.has(d.segmentId)) problems.push(`segment ${d.segmentId} is both planned and deferred`);
  }
  return problems;
}
