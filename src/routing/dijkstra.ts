import type { RoadGraph } from './graph';
import { MinHeap } from './heap';

/** Non-negative cost of traversing an edge. Infinity means the edge cannot be used. */
export type EdgeCost = (edge: number) => number;

export interface ShortestPathTree {
  readonly source: number;
  /** Cost from the source to each node; Infinity if unreachable. */
  readonly dist: Float64Array;
  /** The edge used to reach each node, or −1 for the source and unreachable nodes. */
  readonly prevEdge: Int32Array;
}

export interface Path {
  readonly cost: number;
  readonly edges: readonly number[];
  /** Nodes visited, from the start node to the end node inclusive. */
  readonly nodes: readonly number[];
}

function edgeCost(cost: EdgeCost, e: number): number {
  const c = cost(e);
  if (c < 0) throw new RangeError(`Negative cost ${c} on edge ${e}`);
  return c;
}

/**
 * Shared search: Dijkstra, or A* with a heuristic. Stops when `target` is settled (if given). Ties break by node
 * index through the heap, so results are deterministic.
 */
function search(g: RoadGraph, source: number, cost: EdgeCost, target: number, heuristic?: (node: number) => number): ShortestPathTree {
  const dist = new Float64Array(g.nodeCount).fill(Number.POSITIVE_INFINITY);
  const prevEdge = new Int32Array(g.nodeCount).fill(-1);
  const settled = new Uint8Array(g.nodeCount);
  const heap = new MinHeap();
  dist[source] = 0;
  heap.push(heuristic ? heuristic(source) : 0, source);
  while (heap.size > 0) {
    const u = heap.pop();
    if (settled[u]) continue;
    settled[u] = 1;
    if (u === target) break;
    const du = dist[u]!;
    for (let e = g.firstOut[u]!; e < g.firstOut[u + 1]!; e++) {
      const c = edgeCost(cost, e);
      if (c === Number.POSITIVE_INFINITY) continue;
      const v = g.edgeTo[e]!;
      const dv = du + c;
      if (dv < dist[v]!) {
        dist[v] = dv;
        prevEdge[v] = e;
        heap.push(heuristic ? dv + heuristic(v) : dv, v);
      }
    }
  }
  return { source, dist, prevEdge };
}

/** Dijkstra with a binary heap. Deterministic for identical inputs. Throws RangeError on a negative edge cost. */
export function shortestPathTree(g: RoadGraph, source: number, cost: EdgeCost): ShortestPathTree {
  return search(g, source, cost, -1);
}

/** The path to `to` recorded in a tree, or null if unreachable. */
export function pathFromTree(g: RoadGraph, tree: ShortestPathTree, to: number): Path | null {
  if (tree.dist[to] === Number.POSITIVE_INFINITY) return null;
  const edges: number[] = [];
  let v = to;
  while (v !== tree.source) {
    const e = tree.prevEdge[v]!;
    edges.push(e);
    v = g.edgeFrom[e]!;
  }
  edges.reverse();
  const nodes = [tree.source, ...edges.map((e) => g.edgeTo[e]!)];
  return { cost: tree.dist[to]!, edges, nodes };
}

/**
 * Point-to-point shortest path: A* when a heuristic is given (it must be admissible), otherwise Dijkstra.
 * Null if unreachable. A path from a node to itself has cost 0 and no edges.
 */
export function shortestPath(g: RoadGraph, from: number, to: number, cost: EdgeCost, heuristic?: (node: number) => number): Path | null {
  return pathFromTree(g, search(g, from, cost, to, heuristic), to);
}

/** Admissible time heuristic: straight-line distance to `target` ÷ maxSpeedMps (seconds). */
export function straightLineHeuristic(g: RoadGraph, target: number, maxSpeedMps: number): (node: number) => number {
  const tx = g.nodeX[target]!;
  const ty = g.nodeY[target]!;
  return (node) => Math.hypot(g.nodeX[node]! - tx, g.nodeY[node]! - ty) / maxSpeedMps;
}
