import { BEAT_SPEED_MPS, DETOUR_FACTOR, type ArcPlanInput, type ArcTask, type ArcVehicle } from '../../src/routing/vrp/beats-dynamic';

export interface ArcInstanceOptions {
  /** Grid of cols × rows street tasks, 100 m apart. */
  readonly cols: number;
  readonly rows: number;
  /** Tippers; tipper i's static beat is a contiguous block of columns. */
  readonly vehicles: number;
  /** Tippers absent today (their beats become orphans). */
  readonly absent?: readonly number[];
  readonly availableSec?: number;
  readonly mustServe?: readonly number[];
  readonly closed?: readonly number[];
  readonly budget?: number;
  /** Per-task priority; default: a deterministic spread. */
  readonly priority?: (id: number) => number;
  readonly demandKg?: number;
  readonly payloadKg?: number;
}

/**
 * A synthetic arc-routing instance: tasks on a grid (task id = row × cols + col), neighbours by grid adjacency, all
 * tippers starting and tipping at the origin.
 */
export function arcInstance(o: ArcInstanceOptions): ArcPlanInput {
  const tasks: ArcTask[] = [];
  const neighbours = new Map<number, number[]>();
  const id = (c: number, r: number): number => r * o.cols + c;
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      const t = id(c, r);
      tasks.push({
        id: t,
        x: c * 100,
        y: r * 100,
        serviceSec: 60,
        demandKg: o.demandKg ?? 50,
        priority: o.priority ? o.priority(t) : ((t * 37) % 11) / 10,
        mustServe: o.mustServe?.includes(t) ?? false,
        reachable: !(o.closed?.includes(t) ?? false),
        reason: 'beat',
      });
      const n: number[] = [];
      if (c > 0) n.push(id(c - 1, r));
      if (c + 1 < o.cols) n.push(id(c + 1, r));
      if (r > 0) n.push(id(c, r - 1));
      if (r + 1 < o.rows) n.push(id(c, r + 1));
      neighbours.set(t, n);
    }
  }
  const perBeat = Math.ceil(o.cols / o.vehicles);
  const beatOf = (v: number): number[] => {
    const out: number[] = [];
    for (let c = v * perBeat; c < Math.min(o.cols, (v + 1) * perBeat); c++) {
      for (let r = 0; r < o.rows; r++) out.push(id(c, c % 2 === 0 ? r : o.rows - 1 - r));
    }
    return out;
  };
  const vehicles: ArcVehicle[] = [];
  const orphans: number[] = [];
  for (let v = 0; v < o.vehicles; v++) {
    if (o.absent?.includes(v)) {
      orphans.push(...beatOf(v));
      continue;
    }
    vehicles.push({ id: v, x: 0, y: 0, tipX: 0, tipY: 0, payloadKg: o.payloadKg ?? 1000, loadKg: 0, availableSec: o.availableSec ?? 8 * 3600, beat: beatOf(v) });
  }
  return { tasks, vehicles, orphans, neighbours, speedMps: BEAT_SPEED_MPS, detour: DETOUR_FACTOR, budget: o.budget ?? 2000 };
}

/** The beat each tipper serves in the instance (its static beat), by vehicle id. */
export function staticBeatOwner(o: Pick<ArcInstanceOptions, 'cols' | 'vehicles'>, taskId: number): number {
  const perBeat = Math.ceil(o.cols / o.vehicles);
  return Math.floor((taskId % o.cols) / perBeat);
}
