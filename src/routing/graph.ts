import { notImplemented } from '../shared/not-implemented';
import type { HighwayClass, RoadNetworkInput } from '../geo/snapshot';

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

/** Throws RangeError if a way references a node that is not in the input or has fewer than 2 nodes. */
export function buildGraph(input: RoadNetworkInput): RoadGraph {
  return notImplemented('buildGraph', input);
}

/** Graph node index of an OSM node id, or −1 if it is not a graph node. */
export function nodeIndex(g: RoadGraph, osmId: number): number {
  return notImplemented('nodeIndex', g, osmId);
}
