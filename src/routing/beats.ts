import { rngFromSeed } from '../shared/rng';
import type { RoadGraph } from './graph';
import { MinHeap } from './heap';

/**
 * A street segment served door-to-door in one pass (AD-7). A two-way street's segment holds both of its directed
 * edges (twins), and a one-way street's segment holds its single edge.
 */
export interface StreetSegment {
  readonly id: number;
  readonly edges: readonly number[];
  readonly lengthM: number;
  readonly households: number;
}

/** One segment per twin pair or one-way edge, ids 0..n−1 in ascending order of the segment's lowest edge index. Households 0. */
export function segmentsFromGraph(g: RoadGraph): StreetSegment[] {
  const taken = new Uint8Array(g.edgeCount);
  const out: StreetSegment[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    if (taken[e]) continue;
    taken[e] = 1;
    const twin = g.edgeTwin[e]!;
    const edges = twin >= 0 && !taken[twin] ? [e, twin] : [e];
    if (edges.length === 2) taken[twin] = 1;
    out.push({ id: out.length, edges, lengthM: g.edgeLengthM[e]!, households: 0 });
  }
  return out;
}

export interface Beat {
  readonly id: number;
  readonly segmentIds: readonly number[];
  readonly households: number;
}

const BALANCE_TOLERANCE = 0.15;

function segmentNodes(g: RoadGraph, s: StreetSegment): number[] {
  const e = s.edges[0]!;
  return [g.edgeFrom[e]!, g.edgeTo[e]!];
}

function midpoint(g: RoadGraph, s: StreetSegment): [number, number] {
  const [a, b] = segmentNodes(g, s) as [number, number];
  return [(g.nodeX[a]! + g.nodeX[b]!) / 2, (g.nodeY[a]! + g.nodeY[b]!) / 2];
}

/** Segment adjacency through shared nodes, as sorted neighbour lists. */
function segmentAdjacency(g: RoadGraph, segments: readonly StreetSegment[]): number[][] {
  const byNode = new Map<number, number[]>();
  segments.forEach((s, i) => {
    for (const n of segmentNodes(g, s)) {
      const list = byNode.get(n);
      if (list) list.push(i);
      else byNode.set(n, [i]);
    }
  });
  return segments.map((s, i) => {
    const set = new Set<number>();
    for (const n of segmentNodes(g, s)) for (const j of byNode.get(n)!) if (j !== i) set.add(j);
    return [...set].sort((a, b) => a - b);
  });
}

/** True if `members` minus `removed` is still connected (and non-empty). */
function staysConnected(members: ReadonlySet<number>, removed: number, adj: readonly (readonly number[])[]): boolean {
  if (members.size <= 1) return false;
  let start = -1;
  for (const m of members) {
    if (m !== removed) {
      start = m;
      break;
    }
  }
  const seen = new Set<number>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const u = stack.pop()!;
    for (const v of adj[u]!) {
      if (v !== removed && members.has(v) && !seen.has(v)) {
        seen.add(v);
        stack.push(v);
      }
    }
  }
  return seen.size === members.size - 1;
}

/**
 * Splits segments into k contiguous beats of balanced households (seeded region-growing then boundary swaps).
 * Guarantees: every segment in exactly one beat; each beat's segments connected through shared nodes; each beat's
 * households within ±15% of total ÷ k whenever no segment exceeds 5% of that target; same inputs and seed give the
 * same beats. Throws RangeError if k < 1 or k > the number of segments.
 */
export function partitionBeats(g: RoadGraph, segments: readonly StreetSegment[], k: number, seed: number): Beat[] {
  if (!Number.isInteger(k) || k < 1 || k > segments.length) throw new RangeError(`k must be in 1..${segments.length}, got ${k}`);
  const n = segments.length;
  const adj = segmentAdjacency(g, segments);
  const mids = segments.map((s) => midpoint(g, s));
  const weight = segments.map((s) => s.households);

  // 1. Seeds by farthest-point sampling from a seeded random first segment.
  const rng = rngFromSeed(seed);
  const seeds = [rng.int(0, n - 1)];
  const nearest = mids.map(([x, y]) => Math.hypot(x - mids[seeds[0]!]![0], y - mids[seeds[0]!]![1]));
  while (seeds.length < k) {
    let best = -1;
    for (let i = 0; i < n; i++) if (best < 0 || nearest[i]! > nearest[best]!) best = i;
    seeds.push(best);
    for (let i = 0; i < n; i++) nearest[i] = Math.min(nearest[i]!, Math.hypot(mids[i]![0] - mids[best]![0], mids[i]![1] - mids[best]![1]));
  }

  // 2. Region growing: the lightest beat with a frontier takes its nearest unassigned neighbour.
  const owner = new Int32Array(n).fill(-1);
  const load = new Float64Array(k);
  const frontiers = seeds.map(() => new MinHeap());
  const claim = (beat: number, s: number): void => {
    owner[s] = beat;
    load[beat]! += weight[s]!;
    const [sx, sy] = mids[seeds[beat]!]!;
    for (const t of adj[s]!) if (owner[t] === -1) frontiers[beat]!.push(Math.hypot(mids[t]![0] - sx, mids[t]![1] - sy), t);
  };
  seeds.forEach((s, beat) => {
    claim(beat, s);
  });
  let assigned = k;
  while (assigned < n) {
    let pick = -1;
    for (let beat = 0; beat < k; beat++) {
      const f = frontiers[beat]!;
      while (f.size > 0 && owner[peekValue(f)] !== -1) f.pop();
      if (f.size > 0 && (pick < 0 || load[beat]! < load[pick]!)) pick = beat;
    }
    if (pick < 0) break;
    claim(pick, frontiers[pick]!.pop());
    assigned++;
  }
  // Segments in components no seed reached join the lightest beat (contiguity cannot hold across components).
  for (let s = 0; s < n; s++) {
    if (owner[s] !== -1) continue;
    let lightest = 0;
    for (let beat = 1; beat < k; beat++) if (load[beat]! < load[lightest]!) lightest = beat;
    owner[s] = lightest;
    load[lightest]! += weight[s]!;
  }

  // 3. Boundary swaps from heavier to lighter neighbours while they reduce the worse of the two deviations.
  const total = weight.reduce((a, w) => a + w, 0);
  const target = total / k;
  const members = Array.from({ length: k }, () => new Set<number>());
  for (let s = 0; s < n; s++) members[owner[s]!]!.add(s);
  const withinTolerance = (): boolean => Array.from(load).every((l) => Math.abs(l - target) <= BALANCE_TOLERANCE * target);
  for (let pass = 0; pass < 500 && !withinTolerance(); pass++) {
    let moved = false;
    for (let s = 0; s < n; s++) {
      const a = owner[s]!;
      const w = weight[s]!;
      for (const t of adj[s]!) {
        const b = owner[t]!;
        if (b === a || load[a]! <= load[b]!) continue;
        const before = Math.max(Math.abs(load[a]! - target), Math.abs(load[b]! - target));
        const after = Math.max(Math.abs(load[a]! - w - target), Math.abs(load[b]! + w - target));
        if (after >= before - 1e-9 || !staysConnected(members[a]!, s, adj)) continue;
        members[a]!.delete(s);
        members[b]!.add(s);
        owner[s] = b;
        load[a]! -= w;
        load[b]! += w;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }

  return members.map((set, id) => {
    const segmentIds = [...set].sort((x, y) => x - y);
    return { id, segmentIds, households: segmentIds.reduce((a, s) => a + segments[s]!.households, 0) };
  });
}

/** Value at the top of a heap without popping (pop and push back keeps the order). */
function peekValue(h: MinHeap): number {
  const key = h.peekKey();
  const v = h.pop();
  h.push(key, v);
  return v;
}

export interface BeatWalk {
  /** The beat's segment ids in service order (a permutation of the beat's segments). */
  readonly order: readonly number[];
  /** The full directed edge sequence, connectors included, starting at the start node. Consecutive edges connect. */
  readonly edges: readonly number[];
  /** For each entry of `order`, the index in `edges` of the edge that serves that segment. Strictly increasing. */
  readonly serviceEdgeIndex: readonly number[];
  readonly lengthM: number;
}

/**
 * Covering walk of one beat by length: from the current node, drive the shortest way to the start of the nearest
 * unserved segment edge and serve it, until all are served. The search stops at the first settled node that starts an
 * unserved edge, so each step only explores the neighbourhood. Throws if a segment cannot be reached.
 */
export function orderBeat(g: RoadGraph, segments: readonly StreetSegment[], beat: Beat, startNode: number): BeatWalk {
  const unserved = new Set(beat.segmentIds);
  /** Unserved service edges by start node. */
  const startsAt = new Map<number, number[]>();
  for (const id of beat.segmentIds) {
    for (const e of segments[id]!.edges) {
      const from = g.edgeFrom[e]!;
      const list = startsAt.get(from);
      if (list) list.push(e);
      else startsAt.set(from, [e]);
    }
  }
  const segOfEdge = new Map<number, number>();
  for (const id of beat.segmentIds) for (const e of segments[id]!.edges) segOfEdge.set(e, id);

  const dist = new Float64Array(g.nodeCount).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(g.nodeCount).fill(-1);
  const touched: number[] = [];
  const heap = new MinHeap();

  const order: number[] = [];
  const edges: number[] = [];
  const serviceEdgeIndex: number[] = [];
  let lengthM = 0;
  let current = startNode;

  while (unserved.size > 0) {
    for (const v of touched) {
      dist[v] = Number.POSITIVE_INFINITY;
      prev[v] = -1;
    }
    touched.length = 0;
    heap.clear();
    dist[current] = 0;
    touched.push(current);
    heap.push(0, current);
    let found = -1;
    let foundEdge = -1;
    while (heap.size > 0) {
      const key = heap.peekKey();
      const u = heap.pop();
      const du = dist[u]!;
      if (key > du) continue;
      const candidates = startsAt.get(u)?.filter((e) => unserved.has(segOfEdge.get(e)!));
      if (candidates && candidates.length > 0) {
        found = u;
        foundEdge = Math.min(...candidates);
        break;
      }
      for (let e = g.firstOut[u]!; e < g.firstOut[u + 1]!; e++) {
        const v = g.edgeTo[e]!;
        const dv = du + g.edgeLengthM[e]!;
        if (dv < dist[v]!) {
          if (dist[v] === Number.POSITIVE_INFINITY) touched.push(v);
          dist[v] = dv;
          prev[v] = e;
          heap.push(dv, v);
        }
      }
    }
    if (found < 0) throw new Error(`Beat ${beat.id}: ${unserved.size} segments cannot be reached from node ${current}`);
    const connector: number[] = [];
    for (let v = found; v !== current; v = g.edgeFrom[prev[v]!]!) connector.push(prev[v]!);
    connector.reverse();
    for (const e of connector) {
      edges.push(e);
      lengthM += g.edgeLengthM[e]!;
    }
    const seg = segOfEdge.get(foundEdge)!;
    serviceEdgeIndex.push(edges.length);
    edges.push(foundEdge);
    lengthM += g.edgeLengthM[foundEdge]!;
    order.push(seg);
    unserved.delete(seg);
    current = g.edgeTo[foundEdge]!;
  }
  return { order, edges, serviceEdgeIndex, lengthM };
}

/**
 * A covering walk that serves `order` in exactly that order (M3-D6): from the current node, the shortest way to the
 * nearest start of the next segment's edges, then that edge. Throws if a segment cannot be reached.
 */
export function walkInOrder(g: RoadGraph, segments: readonly StreetSegment[], order: readonly number[], startNode: number): BeatWalk {
  const dist = new Float64Array(g.nodeCount).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(g.nodeCount).fill(-1);
  const touched: number[] = [];
  const heap = new MinHeap();
  const edges: number[] = [];
  const serviceEdgeIndex: number[] = [];
  let lengthM = 0;
  let current = startNode;
  for (const segId of order) {
    const starts = new Map<number, number>();
    for (const e of segments[segId]!.edges) {
      const from = g.edgeFrom[e]!;
      const known = starts.get(from);
      if (known === undefined || e < known) starts.set(from, e);
    }
    for (const v of touched) {
      dist[v] = Number.POSITIVE_INFINITY;
      prev[v] = -1;
    }
    touched.length = 0;
    heap.clear();
    dist[current] = 0;
    touched.push(current);
    heap.push(0, current);
    let found = -1;
    while (heap.size > 0) {
      const key = heap.peekKey();
      const u = heap.pop();
      const du = dist[u]!;
      if (key > du) continue;
      if (starts.has(u)) {
        found = u;
        break;
      }
      for (let e = g.firstOut[u]!; e < g.firstOut[u + 1]!; e++) {
        const v = g.edgeTo[e]!;
        const dv = du + g.edgeLengthM[e]!;
        if (dv < dist[v]!) {
          if (dist[v] === Number.POSITIVE_INFINITY) touched.push(v);
          dist[v] = dv;
          prev[v] = e;
          heap.push(dv, v);
        }
      }
    }
    if (found < 0) throw new Error(`Segment ${segId} cannot be reached from node ${current}`);
    const connector: number[] = [];
    for (let v = found; v !== current; v = g.edgeFrom[prev[v]!]!) connector.push(prev[v]!);
    connector.reverse();
    for (const e of connector) {
      edges.push(e);
      lengthM += g.edgeLengthM[e]!;
    }
    const service = starts.get(found)!;
    serviceEdgeIndex.push(edges.length);
    edges.push(service);
    lengthM += g.edgeLengthM[service]!;
    current = g.edgeTo[service]!;
  }
  return { order: [...order], edges, serviceEdgeIndex, lengthM };
}

/** 2-opt reversals considered per position (the walk is local; longer reversals rarely help). */
const WALK_TWO_OPT_WINDOW = 12;

/**
 * 2-opt on a walk's segment order (DV-3, M3-D6): reversals that shorten the straight-line tour between segment
 * midpoints, then the walk rebuilt in that order with `walkInOrder`. The new walk is kept only if it is really
 * shorter. Deterministic; at most `budget` reversals are tried.
 */
export function improveWalk(g: RoadGraph, segments: readonly StreetSegment[], walk: BeatWalk, startNode: number, budget = 4000): BeatWalk {
  const n = walk.order.length;
  if (n < 3) return walk;
  const order = [...walk.order];
  const pt = (id: number): [number, number] => midpoint(g, segments[id]!);
  const start: [number, number] = [g.nodeX[startNode]!, g.nodeY[startNode]!];
  const d = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let tries = 0;
  for (let improved = true; improved && tries < budget; ) {
    improved = false;
    for (let i = 0; i + 1 < n && tries < budget; i++) {
      for (let j = i + 1; j < Math.min(n, i + 1 + WALK_TWO_OPT_WINDOW) && tries < budget; j++) {
        tries++;
        const p = i === 0 ? start : pt(order[i - 1]!);
        const a = pt(order[i]!);
        const b = pt(order[j]!);
        const delta = j === n - 1 ? d(p, b) - d(p, a) : d(p, b) + d(a, pt(order[j + 1]!)) - d(p, a) - d(b, pt(order[j + 1]!));
        if (delta < -1e-6) {
          const rev = order.slice(i, j + 1).reverse();
          order.splice(i, rev.length, ...rev);
          improved = true;
        }
      }
    }
  }
  if (order.every((id, k) => id === walk.order[k])) return walk;
  const rebuilt = walkInOrder(g, segments, order, startNode);
  return rebuilt.lengthM < walk.lengthM - 1e-6 ? rebuilt : walk;
}
