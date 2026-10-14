import { BufferAttribute, BufferGeometry, DoubleSide, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, PlaneGeometry, ShapeUtils, Vector2, type Color } from 'three';
import { decodeRings, type Point } from '../geo/quantise';
import { HIGHWAY_CLASSES, type DecodedSnapshot } from '../geo/snapshot';
import type { RoadGraph } from '../routing/graph';
import { PALETTE } from './palette';

const ROAD_WIDTH_M: Readonly<Record<string, number>> = {
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  unclassified: 6.5,
  residential: 5.5,
  living_street: 4,
  service: 4,
};

function ringArea(r: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i + 1 < r.length; i++) s += r[i]![0] * r[i + 1]![1] - r[i + 1]![0] * r[i]![1];
  return s / 2;
}

interface Buffers {
  pos: number[];
  col: number[];
}

function pushTri(b: Buffers, c: Color, ...v: number[]): void {
  for (let i = 0; i < 9; i++) b.pos.push(v[i]!);
  for (let k = 0; k < 3; k++) b.col.push(c.r, c.g, c.b);
}

function toGeometry(b: Buffers): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3));
  g.computeVertexNormals();
  return g;
}

/** Road ribbons by class in one mesh (AD-10). Each street is drawn once; major roads sit slightly higher. */
export function buildRoads(g: RoadGraph): Mesh {
  const b: Buffers = { pos: [], col: [] };
  for (let e = 0; e < g.edgeCount; e++) {
    const twin = g.edgeTwin[e]!;
    if (twin >= 0 && twin < e) continue;
    const cls = HIGHWAY_CLASSES[g.edgeClass[e]!]!;
    const half = (ROAD_WIDTH_M[cls] ?? 5) / 2;
    const lift = 0.05 + (HIGHWAY_CLASSES.length - g.edgeClass[e]!) * 0.01;
    const colour = PALETTE.road[cls];
    for (let k = g.shapeStart[e]!; k + 1 < g.shapeStart[e + 1]!; k++) {
      const x0 = g.shapeXY[2 * k]!;
      const y0 = g.shapeXY[2 * k + 1]!;
      const x1 = g.shapeXY[2 * k + 2]!;
      const y1 = g.shapeXY[2 * k + 3]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.01) continue;
      const nx = (-(y1 - y0) / len) * half;
      const ny = ((x1 - x0) / len) * half;
      // Extend each piece by half a width so joints close.
      const ex = ((x1 - x0) / len) * half * 0.5;
      const ey = ((y1 - y0) / len) * half * 0.5;
      const ax = x0 - ex;
      const ay = y0 - ey;
      const bx = x1 + ex;
      const by = y1 + ey;
      pushTri(b, colour, ax + nx, lift, -(ay + ny), ax - nx, lift, -(ay - ny), bx - nx, lift, -(by - ny));
      pushTri(b, colour, ax + nx, lift, -(ay + ny), bx - nx, lift, -(by - ny), bx + nx, lift, -(by + ny));
    }
  }
  const mesh = new Mesh(toGeometry(b), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  mesh.name = 'roads';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Water and parks as flat polygons in one mesh. */
export function buildAreas(snapshot: DecodedSnapshot): Mesh {
  const b: Buffers = { pos: [], col: [] };
  decodeRings(snapshot.areas.rings).forEach((raw, i) => {
    if (raw.length < 4) return;
    const ring = ringArea(raw) < 0 ? [...raw].reverse() : [...raw];
    ring.pop();
    const colour = snapshot.areas.kind[i] === 0 ? PALETTE.water : PALETTE.park;
    const y = snapshot.areas.kind[i] === 0 ? 0.03 : 0.02;
    for (const tri of ShapeUtils.triangulateShape(ring.map(([x, yy]) => new Vector2(x, yy)), [])) {
      const pa = ring[tri[0]!]!;
      const pc = ring[tri[1]!]!;
      const pd = ring[tri[2]!]!;
      pushTri(b, colour, pa[0], y, -pa[1], pc[0], y, -pc[1], pd[0], y, -pd[1]);
    }
  });
  const mesh = new Mesh(toGeometry(b), new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  mesh.name = 'areas';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Soft ward outlines (W-4). */
export function buildWardLines(snapshot: DecodedSnapshot): LineSegments {
  const pos: number[] = [];
  for (const w of snapshot.wards) {
    for (const r of w.rings) {
      for (let i = 0; i + 1 < r.length; i++) pos.push(r[i]![0], 0.6, -r[i]![1], r[i + 1]![0], 0.6, -r[i + 1]![1]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  const lines = new LineSegments(g, new LineBasicMaterial({ color: PALETTE.wardLine, transparent: true, opacity: 0.45 }));
  lines.name = 'wards';
  return lines;
}

export function buildGround(): Mesh {
  const mesh = new Mesh(new PlaneGeometry(30_000, 30_000), new MeshLambertMaterial({ color: PALETTE.ground }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
