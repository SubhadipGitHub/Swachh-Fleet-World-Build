import { notImplemented } from '../shared/not-implemented';
import type { ClusterScale } from '../config/derive';
import type { DecodedSnapshot } from '../geo/snapshot';
import type { RoadGraph } from '../routing/graph';
import type { StreetSegment } from '../routing/beats';

export interface Facilities {
  readonly depotNode: number;
  readonly transferPoints: readonly { readonly id: number; readonly node: number }[];
  readonly kcdcNode: number;
  /** The off-map Mittaganahalli landfill, reached from its exit node after a modelled travel time (L-1 step 6). */
  readonly landfill: { readonly exitNode: number; readonly offMapTravelSec: number };
  readonly dwccNode: number;
}

export type BinKind = 'market' | 'commercial' | 'transfer-point' | 'black-spot';

export interface BinSite {
  readonly id: number;
  readonly node: number;
  readonly kind: BinKind;
  readonly capacityKg: number;
  readonly dailyKg: number;
  readonly profile: 'household' | 'market';
}

export interface BlackSpotSite {
  readonly id: number;
  readonly node: number;
  readonly segmentIds: readonly number[];
}

/** Everything the simulation needs about the place. */
export interface MapData {
  readonly graph: RoadGraph;
  readonly segments: readonly StreetSegment[];
  readonly facilities: Facilities;
  readonly bins: readonly BinSite[];
  readonly blackSpots: readonly BlackSpotSite[];
}

export interface MapDataOptions {
  readonly smartBins: number;
  readonly transferPoints: number;
  readonly seed: number;
}

/**
 * Builds the sim's map from a snapshot (W-3, W-5):
 * - households are spread over segments by nearby residential floor area (footprint area × max(levels, 1)), using
 *   largest-remainder rounding so they sum exactly to round(scale.households)
 * - KCDC is the graph node nearest the snapshot's `kcdc` POI
 * - exactly `transferPoints` transfer points and `smartBins` bins, on distinct valid nodes; market bins go near
 *   marketplace POIs first
 * - exactly round(scale.blackSpots) black spots, each with at least one segment
 * - the same snapshot, scale and seed always give the same map
 */
export function buildMapData(snapshot: DecodedSnapshot, scale: ClusterScale, options: MapDataOptions): MapData {
  return notImplemented('buildMapData', snapshot, scale, options);
}
