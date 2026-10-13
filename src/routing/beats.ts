import { notImplemented } from '../shared/not-implemented';
import type { RoadGraph } from './graph';

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
  return notImplemented('segmentsFromGraph', g);
}

export interface Beat {
  readonly id: number;
  readonly segmentIds: readonly number[];
  readonly households: number;
}

/**
 * Splits segments into k contiguous beats of balanced households (seeded region-growing then boundary swaps).
 * Guarantees: every segment in exactly one beat; each beat's segments connected through shared nodes; each beat's
 * households within ±15% of total ÷ k whenever no segment exceeds 5% of that target; same inputs and seed give the
 * same beats. Throws RangeError if k < 1 or k > the number of segments.
 */
export function partitionBeats(g: RoadGraph, segments: readonly StreetSegment[], k: number, seed: number): Beat[] {
  return notImplemented('partitionBeats', g, segments, k, seed);
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

/** Covering walk of one beat by length: greedy nearest unserved segment with shortest-path connectors, then 2-opt. */
export function orderBeat(g: RoadGraph, segments: readonly StreetSegment[], beat: Beat, startNode: number): BeatWalk {
  return notImplemented('orderBeat', g, segments, beat, startNode);
}
