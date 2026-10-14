import { HIGHWAY_CLASSES, type HighwayClass, type RoadNetworkInput } from '../geo/snapshot';

/**
 * Free-flow speed by road class where OSM has no `maxspeed` (km/h). `assumed`, source `kasaflow-assumptions`.
 */
export const DEFAULT_FREE_SPEED_KMH: Readonly<Record<HighwayClass, number>> = {
  trunk: 50,
  primary: 40,
  secondary: 35,
  tertiary: 30,
  unclassified: 25,
  residential: 20,
  living_street: 10,
  service: 15,
};

/** Total lanes by road class where OSM has no `lanes`. `assumed`, source `kasaflow-assumptions`. */
export const DEFAULT_TOTAL_LANES: Readonly<Record<HighwayClass, number>> = {
  trunk: 4,
  primary: 4,
  secondary: 2,
  tertiary: 2,
  unclassified: 2,
  residential: 2,
  living_street: 1,
  service: 1,
};

/**
 * Directed road graph in compressed-sparse-row form (AD-7).
 *
 * Graph nodes are the OSM nodes that end a way or are shared by two or more ways (junctions). Other way nodes become
 * shape points of an edge. Node indices follow ascending OSM id. Edges are sorted by (from, to, way id), so
 * `firstOut[n] .. firstOut[n+1]-1` are node n's out-edges. A two-way street gives two edges that are each other's
 * `edgeTwin`, and a one-way edge has `edgeTwin` −1. Lanes per direction: a one-way edge gets the way's total lanes,
 * and each direction of a two-way way gets max(1, floor(total ÷ 2)).
 */
export interface RoadGraph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodeOsmId: Float64Array;
  readonly nodeX: Float64Array;
  readonly nodeY: Float64Array;
  readonly firstOut: Uint32Array;
  readonly edgeFrom: Uint32Array;
  readonly edgeTo: Uint32Array;
  readonly edgeLengthM: Float64Array;
  /** Index into HIGHWAY_CLASSES. */
  readonly edgeClass: Uint8Array;
  readonly edgeLanes: Uint8Array;
  readonly edgeFreeSpeedMps: Float64Array;
  readonly edgeWayId: Float64Array;
  readonly edgeTwin: Int32Array;
  /** Edge e's polyline (both end nodes included, in travel direction) is shapeXY[2*shapeStart[e] .. 2*shapeStart[e+1]-1]. */
  readonly shapeStart: Uint32Array;
  readonly shapeXY: Float64Array;
}

interface EdgeRecord {
  readonly from: number;
  readonly to: number;
  readonly wayId: number;
  /** Creation order, the last sort key so equal (from, to, way) edges keep a stable order. */
  readonly seq: number;
  readonly cls: number;
  readonly lanes: number;
  readonly speedMps: number;
  readonly shape: readonly number[];
  readonly lengthM: number;
  /** seq of the twin edge, or −1. */
  twinSeq: number;
}

/** Throws RangeError if a way references a node that is not in the input or has fewer than 2 nodes. */
export function buildGraph(input: RoadNetworkInput): RoadGraph {
  const pos = new Map<number, { x: number; y: number }>();
  for (const n of input.nodes) pos.set(n.id, { x: n.x, y: n.y });

  // Graph nodes: way ends, plus nodes used more than once (by several ways, or twice by one).
  const uses = new Map<number, number>();
  const ends = new Set<number>();
  for (const way of input.ways) {
    if (way.nodes.length < 2) throw new RangeError(`Way ${way.id} has fewer than 2 nodes`);
    for (const id of way.nodes) {
      if (!pos.has(id)) throw new RangeError(`Way ${way.id} references missing node ${id}`);
      uses.set(id, (uses.get(id) ?? 0) + 1);
    }
    ends.add(way.nodes[0]!);
    ends.add(way.nodes[way.nodes.length - 1]!);
  }
  const graphIds = [...uses.keys()].filter((id) => ends.has(id) || uses.get(id)! > 1).sort((a, b) => a - b);
  const indexOf = new Map<number, number>(graphIds.map((id, i) => [id, i]));

  const records: EdgeRecord[] = [];
  for (const way of input.ways) {
    const cls = HIGHWAY_CLASSES.indexOf(way.highway);
    const total = way.lanes ?? DEFAULT_TOTAL_LANES[way.highway];
    const speedMps = (way.maxspeedKmh ?? DEFAULT_FREE_SPEED_KMH[way.highway]) / 3.6;
    let start = 0;
    for (let i = 1; i < way.nodes.length; i++) {
      if (!indexOf.has(way.nodes[i]!)) continue;
      const piece = way.nodes.slice(start, i + 1);
      const shape = piece.flatMap((id) => {
        const p = pos.get(id)!;
        return [p.x, p.y];
      });
      let lengthM = 0;
      for (let k = 2; k < shape.length; k += 2) lengthM += Math.hypot(shape[k]! - shape[k - 2]!, shape[k + 1]! - shape[k - 1]!);
      const a = indexOf.get(piece[0]!)!;
      const b = indexOf.get(piece[piece.length - 1]!)!;
      const reversed: number[] = [];
      for (let k = shape.length - 2; k >= 0; k -= 2) reversed.push(shape[k]!, shape[k + 1]!);
      const twoWay = way.oneway === 'no';
      const lanes = twoWay ? Math.max(1, Math.floor(total / 2)) : Math.max(1, total);
      const base = { wayId: way.id, cls, lanes, speedMps, lengthM, twinSeq: -1 };
      const fwd = way.oneway !== '-1' ? { ...base, from: a, to: b, seq: records.length, shape } : null;
      if (fwd) records.push(fwd);
      const rev = way.oneway !== 'yes' ? { ...base, from: b, to: a, seq: records.length, shape: reversed } : null;
      if (rev) records.push(rev);
      if (fwd && rev) {
        fwd.twinSeq = rev.seq;
        rev.twinSeq = fwd.seq;
      }
      start = i;
    }
  }

  const sorted = [...records].sort((p, q) => p.from - q.from || p.to - q.to || p.wayId - q.wayId || p.seq - q.seq);
  const indexBySeq = new Map<number, number>(sorted.map((r, i) => [r.seq, i]));
  const nodeCount = graphIds.length;
  const edgeCount = sorted.length;
  const g = {
    nodeCount,
    edgeCount,
    nodeOsmId: Float64Array.from(graphIds),
    nodeX: Float64Array.from(graphIds, (id) => pos.get(id)!.x),
    nodeY: Float64Array.from(graphIds, (id) => pos.get(id)!.y),
    firstOut: new Uint32Array(nodeCount + 1),
    edgeFrom: Uint32Array.from(sorted, (r) => r.from),
    edgeTo: Uint32Array.from(sorted, (r) => r.to),
    edgeLengthM: Float64Array.from(sorted, (r) => r.lengthM),
    edgeClass: Uint8Array.from(sorted, (r) => r.cls),
    edgeLanes: Uint8Array.from(sorted, (r) => r.lanes),
    edgeFreeSpeedMps: Float64Array.from(sorted, (r) => r.speedMps),
    edgeWayId: Float64Array.from(sorted, (r) => r.wayId),
    edgeTwin: Int32Array.from(sorted, (r) => (r.twinSeq >= 0 ? indexBySeq.get(r.twinSeq)! : -1)),
    shapeStart: new Uint32Array(edgeCount + 1),
    shapeXY: new Float64Array(sorted.reduce((s, r) => s + r.shape.length, 0)),
  } satisfies RoadGraph;
  for (const r of sorted) g.firstOut[r.from + 1]!++;
  for (let n = 0; n < nodeCount; n++) g.firstOut[n + 1]! += g.firstOut[n]!;
  let off = 0;
  sorted.forEach((r, e) => {
    g.shapeStart[e] = off / 2;
    g.shapeXY.set(r.shape, off);
    off += r.shape.length;
  });
  g.shapeStart[edgeCount] = off / 2;
  return g;
}

/** Graph node index of an OSM node id, or −1 if it is not a graph node. */
export function nodeIndex(g: RoadGraph, osmId: number): number {
  let lo = 0;
  let hi = g.nodeCount - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = g.nodeOsmId[mid]!;
    if (v === osmId) return mid;
    if (v < osmId) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
