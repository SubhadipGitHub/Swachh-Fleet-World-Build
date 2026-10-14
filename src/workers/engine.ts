import { getCalibration } from '../config/calibration';
import { deriveClusterScale } from '../config/derive';
import type { RoutingPolicy, WeatherMode } from '../config/scenario';
import type { IsoDate } from '../config/sources';
import { decodeSnapshot, type SnapshotFiles } from '../geo/snapshot';
import { AlertFeed, type Alert } from '../sim/alerts';
import { DAY_SEC, dayIndex, istDate, secondOfDay } from '../sim/clock';
import { buildMapData } from '../sim/map-data';
import { DisplayIds, wardAt } from '../sim/naming';
import { planDynamic } from '../sim/policies/dynamic';
import type { DayPlan, PlanRequest } from '../sim/policies/types';
import {
  binRows,
  binTimeline,
  binViews,
  blackSpotViews,
  createWorld,
  currentPolicy,
  currentWeather,
  drainEvents,
  fleetRows,
  forecastMae,
  isHeld,
  pendingPlanRequests,
  providePlan,
  routeRows,
  runUntil,
  setPolicy,
  setWeather,
  stepCountsToday,
  stepWorld,
  transferPointTimeline,
  vehicleExplain,
  vehiclePlan,
  vehicleTimeline,
  vehicleViews,
  worldKpis,
  worldMap,
  worldTime,
  type Timeline,
  type World,
} from '../sim/world';
import { baselineLevers, defaultWorldConfig } from '../sim/world-config';
import { FRAME_STRIDE, F, STATE_NAMES, type FacilityView, type FromSim, type FromSolver, type KpiTrend, type MapView, type ToSim, type ToSolver, type TrackerSelection } from './protocol';

const VEHICLE_LENGTH: Readonly<Record<string, number>> = { 'auto-tipper': 4.5, compactor: 9, crew: 8 };
/** Live speed limits (L-6): pause is separate; 600× is the ceiling for any single request. */
const MAX_SPEED = 600;
/** At most this many simulated seconds per tick, so a slow device slows time instead of freezing (AD-5). */
const MAX_STEPS_PER_TICK = 1200;
const DETAIL_EVERY_SEC = 0.25;
const MORNING_SEC = 5 * 3600 + 45 * 60;
/** M2-15: the dashboard message goes out twice a second (real time). */
const DASHBOARD_EVERY_SEC = 0.5;
const TREND_HOURS = 24;
const WEATHER_MODES: readonly WeatherMode[] = ['clear', 'monsoon', 'haze', 'heatwave'];
const POLICIES: readonly RoutingPolicy[] = ['static', 'dynamic'];
/** Real seconds to wait for the solver worker before planning inline. */
const SOLVER_TIMEOUT_SEC = 10;

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** The simulation behind the live view (AD-8). Host-agnostic: a worker or the inline fallback drives it. */
export class SimEngine {
  private world: World | null = null;
  /** The baseline twin (M3-2): same seed and conditions, always Static. Never drawn. */
  private twin: World | null = null;
  /** M3-D9: the solver worker's channel, if one is connected; plans already sent to it. */
  private solver: ((msg: ToSolver) => void) | null = null;
  private readonly sent = new Set<number>();
  /** Real seconds the worlds have been held waiting for the solver worker. */
  private waited = 0;
  private readonly alerts = new AlertFeed();
  private pendingAlerts: Alert[] = [];
  private tracker: TrackerSelection | null = null;
  private sinceDashboard = DASHBOARD_EVERY_SEC;
  private lastTrendHour = -1;
  private trend: { overflowing: number[]; fuelPerTonne: (number | null)[]; coverage: (number | null)[] } = { overflowing: [], fuelPerTonne: [], coverage: [] };
  private names: { vehicles: string[]; bins: { id: string; ward: string }[]; startDate: IsoDate; binCount: number; tpCount: number } | null = null;
  private speed = 60;
  private paused = false;
  private selected: number | null = null;
  private carry = 0;
  private sinceDetail = 0;
  private vehicleCount = 0;

  handle(msg: ToSim): FromSim[] {
    try {
      switch (msg.type) {
        case 'init':
          return this.init(msg.files, msg.seed, msg.startDate, msg.startAtSec);
        case 'setSpeed':
          if (!isNum(msg.speed, 0, MAX_SPEED)) throw new RangeError('speed out of range');
          this.speed = msg.speed;
          return [];
        case 'setPaused':
          this.paused = msg.paused;
          return [];
        case 'select':
          if (msg.vehicleId !== null && !isInt(msg.vehicleId, 0, this.vehicleCount - 1)) throw new RangeError('unknown vehicle');
          this.selected = msg.vehicleId;
          this.sinceDetail = DETAIL_EVERY_SEC;
          return this.selected === null ? [] : this.detail();
        case 'skipTo':
          if (!isInt(msg.secondOfDay, 0, DAY_SEC - 1)) throw new RangeError('secondOfDay out of range');
          return this.skipTo(msg.secondOfDay, msg.reqId);
        case 'skipToMorning':
          return this.skipTo(MORNING_SEC, msg.reqId);
        case 'setWeather':
          if (!WEATHER_MODES.includes(msg.weather)) throw new RangeError(`unknown weather ${msg.weather}`);
          // M3-2: the twin runs under the same conditions, weather included.
          if (this.world) setWeather(this.world, msg.weather);
          if (this.twin) setWeather(this.twin, msg.weather);
          this.sinceDashboard = DASHBOARD_EVERY_SEC;
          return [];
        case 'setPolicy':
          if (!POLICIES.includes(msg.policy)) throw new RangeError(`unknown policy ${msg.policy}`);
          if (this.world) setPolicy(this.world, msg.policy);
          this.sendPending();
          this.sinceDashboard = DASHBOARD_EVERY_SEC;
          return [];
        case 'selectObject': {
          const t = msg.target;
          const names = this.names;
          if (t !== null) {
            const max = t.kind === 'bin' ? (names?.binCount ?? 0) : t.kind === 'transferPoint' ? (names?.tpCount ?? 0) : this.vehicleCount;
            if (!['bin', 'transferPoint', 'vehicle'].includes(t.kind) || !isInt(t.id, 0, max - 1)) throw new RangeError('unknown tracker target');
          }
          this.tracker = t;
          this.sinceDashboard = DASHBOARD_EVERY_SEC;
          return [];
        }
      }
    } catch (e) {
      return [{ type: 'error', message: e instanceof Error ? e.message : String(e) }];
    }
  }

  tick(realDtSec: number): FromSim[] {
    const world = this.world;
    if (!world || this.paused) return [];
    this.carry += this.speed * Math.min(realDtSec, 0.25);
    const steps = Math.min(MAX_STEPS_PER_TICK, Math.floor(this.carry));
    this.carry -= steps;
    if (this.carry > MAX_STEPS_PER_TICK) this.carry = 0;
    // A solver worker that stays silent too long is dropped, and plans are made inline from then on (M3-D9).
    if (this.stepBoth(steps, false) < steps) {
      this.waited += realDtSec;
      if (this.waited > SOLVER_TIMEOUT_SEC) this.connectSolver(null);
    } else {
      this.waited = 0;
    }
    this.absorbEvents();
    const out: FromSim[] = [this.frame(null)];
    this.sinceDetail += realDtSec;
    if (this.selected !== null && this.sinceDetail >= DETAIL_EVERY_SEC) out.push(...this.detail());
    this.sinceDashboard += realDtSec;
    if (this.sinceDashboard >= DASHBOARD_EVERY_SEC) out.push(this.dashboard());
    return out;
  }

  /** M3-D9: connects (or, with null, disconnects) the solver worker. Plans not yet answered are sent to it. */
  connectSolver(send: ((msg: ToSolver) => void) | null): void {
    this.solver = send;
    this.sent.clear();
    this.sendPending();
  }

  /** A message from the solver worker: a plan, or an error that makes the plan fall back to Static. */
  onSolver(msg: FromSolver): void {
    const world = this.world;
    if (!world) return;
    if (msg.type === 'plan') providePlan(world, msg.plan);
    else if (Number.isInteger(msg.reqId)) providePlan(world, { reqId: msg.reqId, error: msg.message });
  }

  private sendPending(): void {
    const world = this.world;
    if (!world || !this.solver) return;
    for (const request of pendingPlanRequests(world)) {
      if (this.sent.has(request.reqId)) continue;
      this.sent.add(request.reqId);
      this.solver({ type: 'solve', request });
    }
  }

  /**
   * Steps both worlds in lockstep. When the live world holds for a plan, the plan is computed inline (no solver
   * worker, or `inline` for skipTo); otherwise both worlds wait for the solver worker. A plan is a pure function of its
   * request, so the result is the same either way. Returns the steps taken.
   */
  private stepBoth(steps: number, inline: boolean): number {
    const world = this.world!;
    for (let i = 0; i < steps; i++) {
      this.sendPending();
      if (isHeld(world)) {
        if (this.solver && !inline) return i;
        for (const req of pendingPlanRequests(world)) providePlan(world, solveInline(req));
      }
      stepWorld(world);
      if (this.twin) stepWorld(this.twin);
    }
    return steps;
  }

  /** Live events feed the alerts; the twin's are discarded. Hourly KPI samples feed the trend. */
  private absorbEvents(): void {
    const world = this.world!;
    this.pendingAlerts.push(...this.alerts.ingest(drainEvents(world)));
    if (this.twin) drainEvents(this.twin);
    const hour = Math.floor(worldTime(world) / 3600);
    if (hour !== this.lastTrendHour) {
      this.lastTrendHour = hour;
      const k = worldKpis(world);
      const push = <T>(list: T[], v: T): void => {
        list.push(v);
        if (list.length > TREND_HOURS) list.shift();
      };
      push(this.trend.overflowing, k.overflowing.total);
      push(this.trend.fuelPerTonne, k.fuel.perTonne);
      push(this.trend.coverage, k.coverage.pct);
    }
  }

  private dashboard(): FromSim {
    const world = this.world!;
    const twin = this.twin ?? world;
    const names = this.names!;
    this.sinceDashboard = 0;
    const alerts = this.pendingAlerts;
    this.pendingAlerts = [];
    const t = worldTime(world);
    const date = istDate(t, names.startDate);
    let timeline: Timeline | null = null;
    const sel = this.tracker;
    if (sel?.kind === 'bin') timeline = binTimeline(world, sel.id);
    else if (sel?.kind === 'transferPoint') timeline = transferPointTimeline(world, sel.id);
    else if (sel?.kind === 'vehicle') timeline = vehicleTimeline(world, sel.id);
    const trend: KpiTrend = { overflowing: [...this.trend.overflowing], fuelPerTonne: [...this.trend.fuelPerTonne], coverage: [...this.trend.coverage] };
    return {
      type: 'dashboard',
      t,
      weather: currentWeather(world),
      policy: currentPolicy(world),
      forecastMae: forecastMae(world),
      kpis: { live: worldKpis(world), twin: worldKpis(twin), trend },
      tables: {
        bins: binRows(world).map((r) => ({
          binIndex: r.binId,
          displayId: names.bins[r.binId]!.id,
          kind: r.kind,
          ward: names.bins[r.binId]!.ward,
          reportedPct: r.reportedPct,
          predictedFullAt: r.predictedFullAt,
          lastServicedAt: r.lastServicedAt,
          sensorStatus: r.sensorStatus,
        })),
        fleet: fleetRows(world).map((r) => ({
          vehicleIndex: r.vehicleId,
          displayId: names.vehicles[r.vehicleId]!,
          kind: r.kind,
          state: r.state,
          loadKg: r.loadKg,
          fuelLitres: r.fuelLitres,
          kmToday: r.kmToday,
          skippedToday: r.skippedToday,
        })),
        routes: routeRows(world).map((r) => ({
          vehicleIndex: r.vehicleId,
          routeId: `R-${date}-${String(r.vehicleId + 1).padStart(3, '0')}`,
          vehicleDisplayId: names.vehicles[r.vehicleId]!,
          stopsDone: r.stopsDone,
          stopsPlanned: r.stopsPlanned,
          kmPlanned: r.kmPlanned,
          kmActual: r.kmActual,
          deviations: r.deviations,
          etaAt: r.etaAt,
          policy: r.policy,
          replans: r.replans,
        })),
      },
      alerts,
      tracker: { selection: sel, timeline, counts: stepCountsToday(world) },
    };
  }

  private init(files: SnapshotFiles, seed: number, startDate: IsoDate, startAtSec: number): FromSim[] {
    if (!isInt(seed, 0, 2 ** 32 - 1) || !isInt(startAtSec, 0, DAY_SEC - 1)) throw new RangeError('bad init parameters');
    const snapshot = decodeSnapshot(files);
    const cal = getCalibration();
    const scale = deriveClusterScale(cal);
    const map = buildMapData(snapshot, scale, { smartBins: cal.smartBins.value, transferPoints: cal.transferPoints.value, seed });
    const config = defaultWorldConfig(cal, scale, 'clear');
    const spec = {
      v: 1 as const,
      seed,
      startDate,
      days: 7,
      weather: 'clear' as const,
      policy: 'static' as const,
      levers: baselineLevers(cal),
    };
    // Neither world has an inline planner: the engine answers the live world's plan requests (M3-D9).
    const world = createWorld(map, config, spec);
    const twin = createWorld(map, config, spec);
    runUntil(world, startAtSec);
    runUntil(twin, startAtSec);
    drainEvents(world);
    drainEvents(twin);
    this.world = world;
    this.twin = twin;

    const g = map.graph;
    const ids = new DisplayIds();
    const views = vehicleViews(world);
    this.vehicleCount = views.length;
    const plans = views.map((v) => vehiclePlan(world, v.id));
    const vehicles = views.map((v) => {
      let displayId: string;
      if (v.kind === 'auto-tipper') {
        const first = plans[v.id]?.beatEdges[0];
        const ward = first === undefined ? null : wardAt(snapshot.wards, g.nodeX[g.edgeFrom[first]!]!, g.nodeY[g.edgeFrom[first]!]!);
        displayId = ids.autoTipper(ward);
      } else {
        displayId = v.kind === 'compactor' ? ids.compactor() : ids.crew();
      }
      return { id: v.id, kind: v.kind, displayId, lengthM: VEHICLE_LENGTH[v.kind] ?? 5 };
    });
    const at = (node: number): { x: number; y: number } => ({ x: g.nodeX[node]!, y: g.nodeY[node]! });
    const kcdcPoi = snapshot.pois.find((p) => p.kind === 'kcdc');
    const dwccPoi = snapshot.pois.find((p) => p.kind === 'recycling-centre');
    const f = map.facilities;
    const facilities: FacilityView[] = [
      { kind: 'depot', id: 0, displayId: 'DEPOT-S-01', name: 'Vehicle depot', ...at(f.depotNode), location: 'assumed' },
      { kind: 'kcdc', id: 0, displayId: 'KCDC', name: 'KCDC compost plant, Kudlu Gate', ...(kcdcPoi ? { x: kcdcPoi.x, y: kcdcPoi.y } : at(f.kcdcNode)), location: kcdcPoi ? 'real' : 'assumed' },
      { kind: 'weighbridge', id: 0, displayId: 'WB-KCDC', name: 'Weighbridge at KCDC', ...at(f.kcdcNode), location: 'assumed' },
      { kind: 'dwcc', id: 0, displayId: 'DWCC-01', name: 'Dry Waste Collection Centre', ...(dwccPoi ? { x: dwccPoi.x, y: dwccPoi.y } : at(f.dwccNode)), location: dwccPoi ? 'real' : 'assumed' },
      { kind: 'landfill-exit', id: 0, displayId: 'TO-LANDFILL', name: 'Route to Mittaganahalli landfill (off map)', ...at(f.landfill.exitNode), location: 'assumed' },
      ...f.transferPoints.map((tp) => ({ kind: 'transfer-point' as const, id: tp.id, displayId: ids.transferPoint(tp.id), name: 'Secondary transfer point', ...at(tp.node), location: 'assumed' as const })),
    ];
    const binNames = map.bins.map((b) => {
      const ward = wardAt(snapshot.wards, g.nodeX[b.node]!, g.nodeY[b.node]!);
      return { id: '', ward: ward ? `${ward.key} ${ward.name}` : 'Outside the wards' };
    });
    const view: MapView = {
      startDate,
      facilities,
      bins: map.bins.map((b) => {
        const p = at(b.node);
        return { id: b.id, kind: b.kind, displayId: ids.bin(wardAt(snapshot.wards, p.x, p.y)), ...p, capacityKg: b.capacityKg };
      }),
      blackSpots: map.blackSpots.map((s) => {
        const p = at(s.node);
        return { id: s.id, displayId: ids.blackSpot(wardAt(snapshot.wards, p.x, p.y)), ...p };
      }),
      vehicles,
      wards: snapshot.wards,
      households: map.segments.reduce((a, s) => a + s.households, 0),
      fetchedAt: snapshot.manifest.fetchedAt,
      floodSpots: map.floodProneSpots.map((s) => ({ id: s.id, ...at(s.node) })),
    };
    view.bins.forEach((b, i) => {
      binNames[i]!.id = b.displayId;
    });
    this.names = { vehicles: vehicles.map((v) => v.displayId), bins: binNames, startDate, binCount: map.bins.length, tpCount: f.transferPoints.length };
    this.lastTrendHour = -1;
    this.absorbEvents();
    return [{ type: 'ready', view, t: worldTime(world) }, this.frame(null)];
  }

  private skipTo(sod: number, reqId: number): FromSim[] {
    const world = this.world;
    if (!world) return [];
    const now = worldTime(world);
    let target = dayIndex(now) * DAY_SEC + sod;
    if (target <= now) target += DAY_SEC;
    // Step both worlds together, absorbing alerts and hourly trend samples on the way.
    while (worldTime(world) < target) {
      const next = Math.min(target, (Math.floor(worldTime(world) / 3600) + 1) * 3600);
      this.stepBoth(next - worldTime(world), true);
      this.absorbEvents();
    }
    this.carry = 0;
    this.sinceDashboard = DASHBOARD_EVERY_SEC;
    return [this.frame(reqId)];
  }

  private frame(reqId: number | null): FromSim {
    const world = this.world!;
    const vs = vehicleViews(world);
    const vehicles = new Float32Array(vs.length * FRAME_STRIDE);
    vs.forEach((v, i) => {
      const o = i * FRAME_STRIDE;
      vehicles[o + F.x] = v.x;
      vehicles[o + F.y] = v.y;
      vehicles[o + F.heading] = v.heading;
      vehicles[o + F.speed] = v.speedMps;
      vehicles[o + F.visible] = v.visible ? 1 : 0;
      vehicles[o + F.state] = STATE_NAMES.indexOf(v.state as (typeof STATE_NAMES)[number]);
      vehicles[o + F.load] = v.payloadKg > 0 ? v.loadKg / v.payloadKg : 0;
      vehicles[o + F.edge] = v.edge;
    });
    const bs = binViews(world);
    const bins = new Float32Array(bs.length * 2);
    bs.forEach((b, i) => {
      bins[2 * i] = b.reportedPct ?? -1;
      bins[2 * i + 1] = b.trueFillPct;
    });
    const spots = Float32Array.from(blackSpotViews(world), (s) => s.sizeKg);
    return { type: 'frame', t: worldTime(world), vehicles, bins, spots, reqId };
  }

  private detail(): FromSim[] {
    const world = this.world;
    if (!world || this.selected === null) return [];
    this.sinceDetail = 0;
    const vehicle = vehicleViews(world)[this.selected];
    const plan = vehiclePlan(world, this.selected);
    if (!vehicle || !plan) return [];
    return [{ type: 'detail', vehicle, plan, explain: vehicleExplain(world, this.selected) }];
  }

  /** For tests and the inline host: the current sim time. */
  time(): number {
    return this.world ? worldTime(this.world) : 0;
  }

  /** Seconds since midnight of the current sim day. */
  secondOfDay(): number {
    return secondOfDay(this.time());
  }

  hasMap(): boolean {
    return this.world !== null && worldMap(this.world).graph.nodeCount > 0;
  }
}

/** The plan for a request, or an error result: a planner failure makes the plan fall back to Static (M3-D9). */
function solveInline(req: PlanRequest): DayPlan | { readonly reqId: number; readonly error: string } {
  try {
    return planDynamic(req);
  } catch (e) {
    return { reqId: req.reqId, error: e instanceof Error ? e.message : String(e) };
  }
}
