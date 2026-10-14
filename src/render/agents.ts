import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleKind } from '../sim/world';
import type { FacilityView, MapView } from '../workers/protocol';
import { PALETTE, fillColour } from './palette';

/** A box of the given size whose min-x face is at `x0`, coloured. */
function part(lx: number, ly: number, lz: number, x0: number, y0: number, colour: Color, z0 = 0): BufferGeometry {
  const g = new BoxGeometry(lx, ly, lz).toNonIndexed();
  g.translate(x0 + lx / 2, y0 + ly / 2, z0);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([colour.r, colour.g, colour.b], i * 3);
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** Low-poly vehicles, front at the origin facing +x (the frame position is the front bumper). */
function vehicleGeometry(kind: VehicleKind): BufferGeometry {
  const body = PALETTE.vehicle[kind];
  const cab = new Color('#f2efe8');
  const dark = new Color('#2b2f33');
  if (kind === 'auto-tipper') {
    return mergeGeometries([
      part(1.3, 1.5, 1.4, -1.3, 0.35, cab),
      part(3.0, 1.0, 1.6, -4.4, 0.45, body),
      part(4.4, 0.35, 1.5, -4.4, 0.1, dark),
    ]);
  }
  if (kind === 'compactor') {
    return mergeGeometries([part(2.2, 2.4, 2.4, -2.2, 0.6, cab), part(6.6, 2.8, 2.5, -8.9, 0.6, body), part(8.9, 0.6, 2.4, -8.9, 0.1, dark)]);
  }
  return mergeGeometries([part(2.2, 2.3, 2.3, -2.2, 0.6, cab), part(5.6, 1.6, 2.4, -7.9, 0.6, body), part(7.9, 0.6, 2.3, -7.9, 0.1, dark)]);
}

const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();
const tmpM = new Matrix4();
const tmpV = new Vector3();
const ONE = new Vector3(1, 1, 1);
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

export interface AgentLayer {
  readonly group: Group;
  /** Places vehicle `index` (in view order) at local (x, y) with heading, or hides it. */
  setVehicle(index: number, x: number, y: number, heading: number, visible: boolean): void;
  setBinFill(index: number, reportedPct: number): void;
  setSpotSize(index: number, sizeKg: number): void;
  commit(): void;
}

/** Vehicles, bins, black spots and overview markers as instanced meshes (AD-10: a handful of draw calls). */
export function buildAgents(view: MapView): AgentLayer {
  const group = new Group();
  group.name = 'agents';
  const material = new MeshLambertMaterial({ vertexColors: true });
  const kinds: VehicleKind[] = ['auto-tipper', 'compactor', 'crew'];
  const meshes = new Map<VehicleKind, InstancedMesh>();
  const slotOf: { kind: VehicleKind; slot: number }[] = [];
  for (const kind of kinds) {
    const count = view.vehicles.filter((v) => v.kind === kind).length;
    const mesh = new InstancedMesh(vehicleGeometry(kind), material, Math.max(1, count));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `vehicles-${kind}`;
    meshes.set(kind, mesh);
    group.add(mesh);
  }
  const perKind = new Map<VehicleKind, number>();
  for (const v of view.vehicles) {
    const slot = perKind.get(v.kind) ?? 0;
    perKind.set(v.kind, slot + 1);
    slotOf.push({ kind: v.kind, slot });
  }

  // Overview markers: one coloured dot per vehicle, constant screen size, so the fleet reads at city zoom.
  const markerPos = new Float32Array(view.vehicles.length * 3);
  const markerCol = new Float32Array(view.vehicles.length * 3);
  view.vehicles.forEach((v, i) => {
    const c = PALETTE.vehicle[v.kind];
    markerCol.set([c.r, c.g, c.b], i * 3);
  });
  const markerGeom = new BufferGeometry();
  // BufferAttribute shares the array (Float32BufferAttribute would copy it, and updates would never reach the GPU).
  markerGeom.setAttribute('position', new BufferAttribute(markerPos, 3).setUsage(DynamicDrawUsage));
  markerGeom.setAttribute('color', new Float32BufferAttribute(markerCol, 3));
  const markers = new Points(markerGeom, new PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
  markers.renderOrder = 10;
  markers.frustumCulled = false;
  markers.name = 'vehicle-markers';
  group.add(markers);

  const bins = new InstancedMesh(new CylinderGeometry(0.7, 0.6, 1.3, 10).translate(0, 0.65, 0), new MeshLambertMaterial(), Math.max(1, view.bins.length));
  bins.name = 'bins';
  bins.castShadow = true;
  const o = new Object3D();
  view.bins.forEach((b, i) => {
    o.position.set(b.x + 3, 0, -(b.y + 3));
    o.updateMatrix();
    bins.setMatrixAt(i, o.matrix);
    bins.setColorAt(i, PALETTE.fill.ok);
  });
  group.add(bins);

  const spots = new InstancedMesh(new ConeGeometry(1, 1, 7).translate(0, 0.5, 0), new MeshLambertMaterial({ color: '#6b5a3e' }), Math.max(1, view.blackSpots.length));
  spots.name = 'black-spots';
  view.blackSpots.forEach((_, i) => {
    spots.setMatrixAt(i, HIDDEN);
  });
  group.add(spots);

  return {
    group,
    setVehicle(index, x, y, heading, visible) {
      const s = slotOf[index]!;
      const mesh = meshes.get(s.kind)!;
      if (!visible) {
        mesh.setMatrixAt(s.slot, HIDDEN);
        markerPos.set([0, -1e4, 0], index * 3);
        return;
      }
      tmpQ.setFromAxisAngle(UP, heading);
      tmpM.compose(tmpV.set(x, 0, -y), tmpQ, ONE);
      mesh.setMatrixAt(s.slot, tmpM);
      markerPos.set([x, 3, -y], index * 3);
    },
    setBinFill(index, reportedPct) {
      bins.setColorAt(index, fillColour(reportedPct));
    },
    setSpotSize(index, sizeKg) {
      const b = view.blackSpots[index]!;
      if (sizeKg <= 0) {
        spots.setMatrixAt(index, HIDDEN);
        return;
      }
      const r = Math.min(6, 1.5 + Math.sqrt(sizeKg) * 0.25);
      o.position.set(b.x - 3, 0, -(b.y - 3));
      o.scale.set(r, r * 0.6, r);
      o.updateMatrix();
      spots.setMatrixAt(index, o.matrix);
      o.scale.set(1, 1, 1);
    },
    commit() {
      for (const m of meshes.values()) m.instanceMatrix.needsUpdate = true;
      markerGeom.getAttribute('position').needsUpdate = true;
      bins.instanceMatrix.needsUpdate = true;
      if (bins.instanceColor) bins.instanceColor.needsUpdate = true;
      spots.instanceMatrix.needsUpdate = true;
    },
  };
}

const FACILITY_LOOK: Readonly<Record<FacilityView['kind'], { size: [number, number, number]; colour: string }>> = {
  depot: { size: [36, 5, 22], colour: '#7b8a96' },
  kcdc: { size: [70, 9, 40], colour: '#8f7b5a' },
  weighbridge: { size: [18, 0.6, 5], colour: '#5d6670' },
  dwcc: { size: [22, 6, 14], colour: '#4f8a8b' },
  'transfer-point': { size: [10, 3, 6], colour: '#c9832f' },
  'landfill-exit': { size: [4, 6, 4], colour: '#9c4a3c' },
};

/** Where a facility block is drawn: beside its node so it never sits on the road (the weighbridge sits on it). */
/** The facility block's colour, also used for its floating label (CR-2). */
export function facilityColour(kind: FacilityView['kind']): string {
  return FACILITY_LOOK[kind].colour;
}

export function facilityCentre(f: FacilityView): { x: number; y: number } {
  const { size } = FACILITY_LOOK[f.kind];
  const offset = f.kind === 'weighbridge' ? 0 : size[2] / 2 + 8;
  return { x: f.x - offset, y: f.y - offset };
}

/** Low-poly facility blocks (W-3), merged by kind. Placed beside their node so they never sit on the road. */
export function buildFacilities(view: MapView): Group {
  const group = new Group();
  group.name = 'facilities';
  for (const kind of Object.keys(FACILITY_LOOK) as FacilityView['kind'][]) {
    const list = view.facilities.filter((f) => f.kind === kind);
    if (list.length === 0) continue;
    const { size, colour } = FACILITY_LOOK[kind];
    const geoms = list.map((f) => {
      const g = new BoxGeometry(...size);
      const c = facilityCentre(f);
      g.translate(c.x, size[1] / 2, -c.y);
      return g;
    });
    const mesh = new Mesh(mergeGeometries(geoms), new MeshLambertMaterial({ color: colour }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `facility-${kind}`;
    group.add(mesh);
  }
  return group;
}
