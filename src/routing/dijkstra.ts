import { notImplemented } from '../shared/not-implemented';
import type { RoadGraph } from './graph';

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

/** Dijkstra with a binary heap. Deterministic for identical inputs. Throws RangeError on a negative edge cost. */
export function shortestPathTree(g: RoadGraph, source: number, cost: EdgeCost): ShortestPathTree {
  return notImplemented('shortestPathTree', g, source, cost);
}

/** The path to `to` recorded in a tree, or null if unreachable. */
export function pathFromTree(g: RoadGraph, tree: ShortestPathTree, to: number): Path | null {
  return notImplemented('pathFromTree', g, tree, to);
}

/**
 * Point-to-point shortest path: A* when a heuristic is given (it must be admissible), otherwise Dijkstra.
 * Null if unreachable. A path from a node to itself has cost 0 and no edges.
 */
export function shortestPath(g: RoadGraph, from: number, to: number, cost: EdgeCost, heuristic?: (node: number) => number): Path | null {
  return notImplemented('shortestPath', g, from, to, cost, heuristic);
}

/** Admissible time heuristic: straight-line distance to `target` ÷ maxSpeedMps (seconds). */
export function straightLineHeuristic(g: RoadGraph, target: number, maxSpeedMps: number): (node: number) => number {
  return notImplemented('straightLineHeuristic', g, target, maxSpeedMps);
}
