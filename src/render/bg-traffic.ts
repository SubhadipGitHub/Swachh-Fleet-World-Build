import { BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { HIGHWAY_CLASSES } from '../geo/snapshot';
import { pointAlongEdge } from '../routing/geometry';
import type { RoadGraph } from '../routing/graph';
import { bucketOf, edgeSpeedMps, type SpeedModel } from '../routing/travel-time';
import { rngFromSeed, type Rng } from '../shared/rng';
import { secondOfDay } from '../sim/clock';
import { addVehicle, createTraffic, positions, removeVehicle, stepTraffic, type Traffic } from '../sim/movement/traffic';
import { laneOffsetM } from '../sim/world';

/**
 * Background traffic (L-4, AD-6 tier 2): cars, two-wheelers, autos and buses on the main roads, purely visual.
 * They follow the same lane-queue rules among themselves. Fleet vehicles are simulated elsewhere, so any background
 * vehicle within a few metres of a fleet vehicle is not drawn that frame, and nothing appears to overlap.
 */
const TYPES = [
  { name: 'car', lengthM: 4.2, size: [4.2, 1.5, 1.8], colours: ['#d9d4c7', '#4a6fa5', '#9e3b34', '#e2e2e2', '#3b3f45'], share: 0.45 },
  { name: 'two-wheeler', lengthM: 1.9, size: [1.9, 1.2, 0.7], colours: ['#2e3236', '#5a2f2f', '#2f4a5a'], share: 0.3 },
  { name: 'auto', lengthM: 2.8, size: [2.8, 1.7, 1.4], colours: ['#2f6b3a', '#d4b43a'], share: 0.18 },
  { name: 'bus', lengthM: 11, size: [11, 3.1, 2.6], colours: ['#2f7d4a', '#c24a35', '#3a5f9e'], share: 0.07 },
] as const;
const HIDE_NEAR_FLEET_M = 7;
const ROUTE_EDGES = 40;

const UP = new Vector3(0, 1, 0);
const q = new Quaternion();
const m = new Matrix4();
const v = new Vector3();
const ONE = new Vector3(1, 1, 1);
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

export class BackgroundTraffic {
  readonly group = new Group();
  private readonly traffic: Traffic;
  private readonly rng: Rng;
  private readonly major: Uint8Array;
  private readonly meshes: InstancedMesh[] = [];
  /** For each car: type index and slot within that type's mesh. */
  private readonly cars: { type: number; slot: number; lengthM: number }[] = [];
  private carry = 0;
  private simT = 0;

  constructor(
    private readonly g: RoadGraph,
    private readonly speed: SpeedModel,
    count: number,
    seed: number,
  ) {
    this.group.name = 'background-traffic';
    this.rng = rngFromSeed(seed);
    const majorClasses = new Set(['trunk', 'primary', 'secondary', 'tertiary'].map((c) => HIGHWAY_CLASSES.indexOf(c as (typeof HIGHWAY_CLASSES)[number])));
    this.major = Uint8Array.from({ length: g.edgeCount }, (_, e) => (majorClasses.has(g.edgeClass[e]!) && g.edgeLengthM[e]! > 3 ? 1 : 0));
    this.traffic = createTraffic(g, (edge, t) => edgeSpeedMps(g, edge, bucketOf(secondOfDay(t)), this.speed) * 0.9);
    const counts = TYPES.map(() => 0);
    for (let i = 0; i < count; i++) {
      const r = this.rng.next();
      let acc = 0;
      let type = 0;
      for (let k = 0; k < TYPES.length; k++) {
        acc += TYPES[k]!.share;
        if (r < acc) {
          type = k;
          break;
        }
      }
      this.cars.push({ type, slot: counts[type]!, lengthM: TYPES[type]!.lengthM });
      counts[type]!++;
    }
    TYPES.forEach((t, k) => {
      const geom = new BoxGeometry(...t.size).translate(-t.size[0] / 2, t.size[1] / 2, 0);
      const mesh = new InstancedMesh(geom, new MeshLambertMaterial(), Math.max(1, counts[k]!));
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.name = `bg-${t.name}`;
      for (let s = 0; s < counts[k]!; s++) {
        mesh.setColorAt(s, new Color(t.colours[s % t.colours.length]));
        mesh.setMatrixAt(s, HIDDEN);
      }
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
    const majorEdges: number[] = [];
    for (let e = 0; e < g.edgeCount; e++) if (this.major[e]) majorEdges.push(e);
    if (majorEdges.length === 0) return;
    this.cars.forEach((car, id) => {
      const start = majorEdges[this.rng.int(0, majorEdges.length - 1)]!;
      addVehicle(this.traffic, { id, lengthM: car.lengthM, route: this.walk(start), departAt: this.rng.int(0, 120) });
    });
  }

  /** A random walk on main roads from `first`, avoiding U-turns where another way exists. */
  private walk(first: number): number[] {
    const g = this.g;
    const route = [first];
    let prev = first;
    for (let i = 1; i < ROUTE_EDGES; i++) {
      const node = g.edgeTo[prev]!;
      const options: number[] = [];
      for (let e = g.firstOut[node]!; e < g.firstOut[node + 1]!; e++) if (this.major[e] && e !== g.edgeTwin[prev]) options.push(e);
      if (options.length === 0) {
        const back = g.edgeTwin[prev]!;
        if (back < 0) break;
        options.push(back);
      }
      prev = options[this.rng.int(0, options.length - 1)]!;
      route.push(prev);
    }
    return route;
  }

  /** Advances by `simDt` simulated seconds in 1-second steps. */
  step(simDt: number, simT: number): void {
    this.carry += simDt;
    if (this.carry > 8) this.carry = 8;
    while (this.carry >= 1) {
      this.carry -= 1;
      for (const ev of stepTraffic(this.traffic, this.simT, 1)) {
        if (ev.kind !== 'Arrived') continue;
        const last = this.lastEdge.get(ev.id);
        removeVehicle(this.traffic, ev.id);
        const car = this.cars[ev.id]!;
        const next = last !== undefined ? this.walk(this.nextFrom(last)) : null;
        if (next) addVehicle(this.traffic, { id: ev.id, lengthM: car.lengthM, route: next, departAt: this.simT + 1 });
      }
      this.simT++;
    }
    this.simT = Math.max(this.simT, Math.floor(simT));
  }

  private readonly lastEdge = new Map<number, number>();

  private nextFrom(edge: number): number {
    const g = this.g;
    const node = g.edgeTo[edge]!;
    const options: number[] = [];
    for (let e = g.firstOut[node]!; e < g.firstOut[node + 1]!; e++) if (this.major[e] && e !== g.edgeTwin[edge]) options.push(e);
    if (options.length === 0) return g.edgeTwin[edge]! >= 0 ? g.edgeTwin[edge]! : edge;
    return options[this.rng.int(0, options.length - 1)]!;
  }

  /** Writes instance matrices, hiding any car close to a fleet vehicle. */
  render(fleet: readonly { x: number; y: number }[]): void {
    for (let i = 0; i < this.cars.length; i++) this.meshes[this.cars[i]!.type]!.setMatrixAt(this.cars[i]!.slot, HIDDEN);
    for (const p of positions(this.traffic)) {
      this.lastEdge.set(p.id, p.edge);
      const pt = pointAlongEdge(this.g, p.edge, p.s);
      const off = laneOffsetM(this.g, p.edge, p.lane);
      const x = pt.x - Math.sin(pt.heading) * off;
      const y = pt.y + Math.cos(pt.heading) * off;
      if (fleet.some((f) => Math.abs(f.x - x) < HIDE_NEAR_FLEET_M && Math.abs(f.y - y) < HIDE_NEAR_FLEET_M)) continue;
      const car = this.cars[p.id]!;
      q.setFromAxisAngle(UP, pt.heading);
      m.compose(v.set(x, 0, -y), q, ONE);
      this.meshes[car.type]!.setMatrixAt(car.slot, m);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
