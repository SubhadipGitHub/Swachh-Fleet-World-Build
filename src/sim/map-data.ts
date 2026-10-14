import type { ClusterScale } from '../config/derive';
import { SpatialHash } from '../geo/spatial-hash';
import { decodeRings } from '../geo/quantise';
import { BUILDING_KINDS, HIGHWAY_CLASSES, type DecodedSnapshot } from '../geo/snapshot';
import { buildGraph, type RoadGraph } from '../routing/graph';
import { segmentsFromGraph, type StreetSegment } from '../routing/beats';
import { largestComponentMask } from '../routing/scc';
import { rngFromSeed } from '../shared/rng';

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

/** A flood-prone spot (M2-5, `assumed`): the edges within 40 m of it close in a monsoon, both directions. */
export interface FloodSpot {
  readonly id: number;
  readonly node: number;
  readonly edges: readonly number[];
}

/** Everything the simulation needs about the place. */
export interface MapData {
  readonly graph: RoadGraph;
  readonly segments: readonly StreetSegment[];
  readonly facilities: Facilities;
  readonly bins: readonly BinSite[];
  readonly blackSpots: readonly BlackSpotSite[];
  readonly floodProneSpots: readonly FloodSpot[];
}

export interface MapDataOptions {
  readonly smartBins: number;
  readonly transferPoints: number;
  readonly seed: number;
}

/** Off-map haul to Mittaganahalli, about 30 km at ~25 km/h (`assumed`). */
export const LANDFILL_OFF_MAP_SEC = 4300;

/** Bin sizes and daily inflows (`assumed`, kasaflow-assumptions). */
const BIN_SPECS: Readonly<Record<BinKind, { capacityKg: number; dailyKg: number; profile: 'household' | 'market' }>> = {
  market: { capacityKg: 240, dailyKg: 120, profile: 'market' },
  commercial: { capacityKg: 120, dailyKg: 50, profile: 'market' },
  // The container at a secondary transfer point holds about one compactor load; its fill includes tipped waste.
  'transfer-point': { capacityKg: 6000, dailyKg: 30, profile: 'household' },
  'black-spot': { capacityKg: 120, dailyKg: 40, profile: 'household' },
};

/** Building kinds whose floor area counts as homes (OSM `building=yes` is mostly housing in these wards). */
const HOME_KINDS = new Set(['house', 'apartments', 'residential', 'other']);
/** Classes on which door-to-door service runs (not trunk roads). */
const SERVED = new Set(HIGHWAY_CLASSES.filter((c) => c !== 'trunk').map((c) => HIGHWAY_CLASSES.indexOf(c)));
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary'].map((c) => HIGHWAY_CLASSES.indexOf(c as (typeof HIGHWAY_CLASSES)[number])));

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Largest-remainder rounding of `total` in proportion to `weights` (sums exactly to total). */
function apportion(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, v) => a + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    if (weights[i]! > 0) {
      out[i]!++;
      left--;
    }
  }
  return out;
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
 *
 * Service and facilities are limited to the largest strongly connected part of the network, so every stop can be
 * reached and left again.
 */
export function buildMapData(snapshot: DecodedSnapshot, scale: ClusterScale, options: MapDataOptions): MapData {
  const g = buildGraph(snapshot.roads);
  const inCore = largestComponentMask(g);
  const rng = rngFromSeed(options.seed);
  const baseSegments = segmentsFromGraph(g);
  const coreSegment = baseSegments.map((s) => s.edges.every((e) => inCore[g.edgeFrom[e]!] && inCore[g.edgeTo[e]!]));
  const servedSegment = baseSegments.map((s, i) => coreSegment[i]! && SERVED.has(g.edgeClass[s.edges[0]!]!));

  // Nodes of the core, for nearest-node lookups.
  const coreNodes = new SpatialHash(100);
  for (let n = 0; n < g.nodeCount; n++) if (inCore[n]) coreNodes.insert(n, g.nodeX[n]!, g.nodeY[n]!);
  const nearestNode = (x: number, y: number, exclude: ReadonlySet<number> = new Set()): number => {
    for (let r = 100; r < 50_000; r *= 2) {
      const ids = coreNodes.queryRadius(x, y, r).filter((id) => !exclude.has(id));
      if (ids.length > 0) {
        let best = ids[0]!;
        let bestD = Infinity;
        for (const id of ids) {
          const d = Math.hypot(g.nodeX[id]! - x, g.nodeY[id]! - y);
          if (d < bestD) {
            best = id;
            bestD = d;
          }
        }
        return best;
      }
    }
    throw new Error('No reachable road node near the requested point');
  };

  // Households from residential floor area, assigned to the nearest served segment.
  const segMid = new SpatialHash(150);
  baseSegments.forEach((s, i) => {
    if (!servedSegment[i]) return;
    const e = s.edges[0]!;
    segMid.insert(i, (g.nodeX[g.edgeFrom[e]!]! + g.nodeX[g.edgeTo[e]!]!) / 2, (g.nodeY[g.edgeFrom[e]!]! + g.nodeY[g.edgeTo[e]!]!) / 2);
  });
  const floorArea = new Float64Array(baseSegments.length);
  const rings = decodeRings(snapshot.buildings.rings);
  rings.forEach((ring, b) => {
    if (!HOME_KINDS.has(BUILDING_KINDS[snapshot.buildings.kind[b]!] ?? 'other')) return;
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i + 1 < ring.length; i++) {
      area += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
      cx += ring[i]![0];
      cy += ring[i]![1];
    }
    const n = Math.max(1, ring.length - 1);
    cx /= n;
    cy /= n;
    const floors = Math.max(1, snapshot.buildings.levels[b]!);
    let best = -1;
    let bestD = Infinity;
    for (let r = 120; r <= 480 && best < 0; r *= 2) {
      for (const si of segMid.queryRadius(cx, cy, r)) {
        const e = baseSegments[si]!.edges[0]!;
        const shapeA = g.shapeStart[e]!;
        const shapeB = g.shapeStart[e + 1]!;
        for (let k = shapeA; k + 1 < shapeB; k++) {
          const d = pointSegmentDistance(cx, cy, g.shapeXY[2 * k]!, g.shapeXY[2 * k + 1]!, g.shapeXY[2 * k + 2]!, g.shapeXY[2 * k + 3]!);
          if (d < bestD || (d === bestD && si < best)) {
            bestD = d;
            best = si;
          }
        }
      }
    }
    if (best >= 0) floorArea[best]! += (Math.abs(area) / 2) * floors;
  });
  const weights = Array.from(floorArea);
  const totalHouseholds = Math.round(scale.households.value);
  const fallback = weights.every((w) => w === 0);
  const households = apportion(
    fallback ? baseSegments.map((s, i) => (servedSegment[i] ? s.lengthM : 0)) : weights,
    totalHouseholds,
  );
  const segments: StreetSegment[] = baseSegments.map((s, i) => ({ ...s, households: households[i]! }));

  // Facilities.
  const centroid = (() => {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let v = 0; v < g.nodeCount; v++) {
      if (!inCore[v]) continue;
      x += g.nodeX[v]!;
      y += g.nodeY[v]!;
      n++;
    }
    return [x / n, y / n] as const;
  })();
  const used = new Set<number>();
  const take = (node: number): number => {
    used.add(node);
    return node;
  };
  const kcdcPoi = snapshot.pois.find((p) => p.kind === 'kcdc');
  const kcdcNode = take(kcdcPoi ? nearestNode(kcdcPoi.x, kcdcPoi.y) : nearestNode(centroid[0], centroid[1]));
  const depotNode = take(nearestNode(centroid[0], centroid[1], used));
  const recycling = snapshot.pois.find((p) => p.kind === 'recycling-centre');
  const dwccNode = take(recycling ? nearestNode(recycling.x, recycling.y, used) : nearestNode(centroid[0] + 300, centroid[1] - 300, used));

  const isMajorNode = (n: number): boolean => {
    for (let e = g.firstOut[n]!; e < g.firstOut[n + 1]!; e++) if (MAJOR.has(g.edgeClass[e]!)) return true;
    return false;
  };
  const coreList: number[] = [];
  for (let v = 0; v < g.nodeCount; v++) if (inCore[v]) coreList.push(v);
  const majorList = coreList.filter(isMajorNode);
  const exitCandidates = majorList.length > 0 ? majorList : coreList;
  let exitNode = exitCandidates[0]!;
  for (const v of exitCandidates) if (g.nodeX[v]! + g.nodeY[v]! > g.nodeX[exitNode]! + g.nodeY[exitNode]!) exitNode = v;

  // Transfer points where the waste is: household-weighted k-means over served segments (farthest-point start),
  // each centre snapped to the nearest free major-road node.
  const tpCandidates = (majorList.length >= options.transferPoints * 2 ? majorList : coreList).filter((v) => !used.has(v));
  const transferPoints: { id: number; node: number }[] = [];
  if (options.transferPoints > 0) {
    const pts = segments
      .filter((s) => s.households > 0)
      .map((s) => {
        const e = s.edges[0]!;
        return { x: (g.nodeX[g.edgeFrom[e]!]! + g.nodeX[g.edgeTo[e]!]!) / 2, y: (g.nodeY[g.edgeFrom[e]!]! + g.nodeY[g.edgeTo[e]!]!) / 2, w: s.households };
      });
    const centres: { x: number; y: number }[] = [];
    if (pts.length > 0) {
      let first = pts[0]!;
      for (const p of pts) if (Math.hypot(p.x - centroid[0], p.y - centroid[1]) < Math.hypot(first.x - centroid[0], first.y - centroid[1])) first = p;
      centres.push({ x: first.x, y: first.y });
      while (centres.length < Math.min(options.transferPoints, pts.length)) {
        let best = pts[0]!;
        let bestD = -1;
        for (const p of pts) {
          const d = Math.min(...centres.map((c) => Math.hypot(p.x - c.x, p.y - c.y)));
          if (d > bestD) {
            bestD = d;
            best = p;
          }
        }
        centres.push({ x: best.x, y: best.y });
      }
      for (let iter = 0; iter < 12; iter++) {
        const sx = centres.map(() => 0);
        const sy = centres.map(() => 0);
        const sw = centres.map(() => 0);
        for (const p of pts) {
          let k = 0;
          for (let c = 1; c < centres.length; c++) if (Math.hypot(p.x - centres[c]!.x, p.y - centres[c]!.y) < Math.hypot(p.x - centres[k]!.x, p.y - centres[k]!.y)) k = c;
          sx[k]! += p.x * p.w;
          sy[k]! += p.y * p.w;
          sw[k]! += p.w;
        }
        centres.forEach((c, k) => {
          if (sw[k]! > 0) {
            c.x = sx[k]! / sw[k]!;
            c.y = sy[k]! / sw[k]!;
          }
        });
      }
    }
    while (centres.length < options.transferPoints) centres.push({ x: centroid[0], y: centroid[1] });
    const candidateSet = new Set(tpCandidates);
    for (const c of centres) {
      const exclude = new Set([...used, ...coreList.filter((v) => !candidateSet.has(v))]);
      const node = exclude.size < coreList.length ? nearestNode(c.x, c.y, exclude) : nearestNode(c.x, c.y, used);
      transferPoints.push({ id: transferPoints.length, node: take(node) });
    }
  }

  // Black spots on busy served segments, chosen with probability ∝ households.
  const blackSpotCount = Math.round(scale.blackSpots.value);
  const candidates = segments.filter((s) => s.households > 0).map((s) => s.id);
  const blackSpots: BlackSpotSite[] = [];
  const spotSegments = new Set<number>();
  const adjacentServed = (s: StreetSegment): number[] => {
    const nodes = new Set(s.edges.flatMap((e) => [g.edgeFrom[e]!, g.edgeTo[e]!]));
    return segments.filter((o) => o.id !== s.id && o.households > 0 && o.edges.some((e) => nodes.has(g.edgeFrom[e]!) || nodes.has(g.edgeTo[e]!))).map((o) => o.id);
  };
  for (let i = 0; i < blackSpotCount; i++) {
    const pool = candidates.filter((id) => !spotSegments.has(id));
    const fromPool = pool.length > 0 ? pool : segments.filter((s) => servedSegment[s.id]).map((s) => s.id);
    const total = fromPool.reduce((a, id) => a + Math.max(1, segments[id]!.households), 0);
    let r = rng.next() * total;
    let pick = fromPool[fromPool.length - 1]!;
    for (const id of fromPool) {
      r -= Math.max(1, segments[id]!.households);
      if (r < 0) {
        pick = id;
        break;
      }
    }
    const seg = segments[pick]!;
    const segIds = [pick, ...adjacentServed(seg).slice(0, 2)];
    for (const id of segIds) spotSegments.add(id);
    blackSpots.push({ id: i, node: g.edgeFrom[seg.edges[0]!]!, segmentIds: segIds });
  }

  // Smart bins: one at each transfer point, one at each black spot, markets (≤ 40%), the rest on shopping streets.
  const bins: BinSite[] = [];
  const addBin = (node: number, kind: BinKind): void => {
    if (bins.length >= options.smartBins) return;
    bins.push({ id: bins.length, node, kind, ...BIN_SPECS[kind] });
  };
  for (const tp of transferPoints) addBin(tp.node, 'transfer-point');
  for (const spot of blackSpots) addBin(spot.node, 'black-spot');
  const markets = snapshot.pois.filter((p) => p.kind === 'marketplace');
  const marketCap = Math.floor(options.smartBins * 0.4);
  const binNodes = new Set(bins.map((b) => b.node));
  let marketBins = 0;
  for (let round = 0; round < 3 && marketBins < marketCap; round++) {
    for (const m of markets) {
      if (marketBins >= marketCap) break;
      const node = nearestNode(m.x, m.y, binNodes);
      binNodes.add(node);
      addBin(node, 'market');
      marketBins++;
    }
  }
  const shopCount = new Map<number, number>();
  for (const p of snapshot.pois) {
    if (p.kind !== 'shop') continue;
    const node = nearestNode(p.x, p.y);
    shopCount.set(node, (shopCount.get(node) ?? 0) + 1);
  }
  const shopNodes = [...shopCount].filter(([n]) => !binNodes.has(n)).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  for (const [node] of shopNodes) {
    if (bins.length >= options.smartBins) break;
    binNodes.add(node);
    addBin(node, 'commercial');
  }
  // Without enough shops, spread the remaining bins evenly over the core.
  while (bins.length < options.smartBins) {
    let best = -1;
    let bestD = -1;
    for (const v of coreList) {
      if (binNodes.has(v)) continue;
      let d = Infinity;
      for (const n of binNodes) d = Math.min(d, Math.hypot(g.nodeX[v]! - g.nodeX[n]!, g.nodeY[v]! - g.nodeY[n]!));
      if (d > bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best < 0) throw new Error('Not enough road nodes for the smart bins');
    binNodes.add(best);
    addBin(best, 'commercial');
  }

  return {
    graph: g,
    segments,
    facilities: { depotNode, transferPoints, kcdcNode, landfill: { exitNode, offMapTravelSec: LANDFILL_OFF_MAP_SEC }, dwccNode },
    bins,
    blackSpots,
    floodProneSpots: findFloodProneSpots(g, snapshot.areas, inCore),
  };
}

/**
 * M2-5: up to 12 flood-prone spots on road nodes of the reachable core within 120 m of a water area, chosen
 * farthest-first (starting with the node closest to water) so they spread out; each spot closes every edge with a
 * point within 40 m of it, in both directions. Deterministic. None when the snapshot has no water.
 */
export function findFloodProneSpots(g: RoadGraph, areas: DecodedSnapshot['areas'], inCore: Uint8Array): FloodSpot[] {
  const water = decodeRings(areas.rings).filter((_, i) => areas.kind[i] === 0 && _.length >= 3);
  if (water.length === 0) return [];
  const boxes = water.map((r) => [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))] as const);
  const inside = (x: number, y: number, ring: readonly (readonly [number, number])[]): boolean => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const waterDistance = (x: number, y: number): number => {
    let best = Infinity;
    water.forEach((ring, i) => {
      const [x0, y0, x1, y1] = boxes[i]!;
      if (x < x0 - FLOOD_NEAR_WATER_M || x > x1 + FLOOD_NEAR_WATER_M || y < y0 - FLOOD_NEAR_WATER_M || y > y1 + FLOOD_NEAR_WATER_M) return;
      if (inside(x, y, ring)) best = 0;
      for (let k = 0; k + 1 < ring.length && best > 0; k++) best = Math.min(best, pointSegmentDistance(x, y, ring[k]![0], ring[k]![1], ring[k + 1]![0], ring[k + 1]![1]));
    });
    return best;
  };
  const candidates: { node: number; d: number }[] = [];
  for (let n = 0; n < g.nodeCount; n++) {
    if (!inCore[n]) continue;
    const d = waterDistance(g.nodeX[n]!, g.nodeY[n]!);
    if (d <= FLOOD_NEAR_WATER_M) candidates.push({ node: n, d });
  }
  if (candidates.length === 0) return [];
  const dist = (a: number, b: number): number => Math.hypot(g.nodeX[a]! - g.nodeX[b]!, g.nodeY[a]! - g.nodeY[b]!);
  let first = candidates[0]!;
  for (const c of candidates) if (c.d < first.d) first = c;
  const chosen = [first.node];
  while (chosen.length < FLOOD_MAX_SPOTS) {
    let best = -1;
    let bestD = -1;
    for (const c of candidates) {
      const d = Math.min(...chosen.map((s) => dist(c.node, s)));
      if (d > bestD) {
        bestD = d;
        best = c.node;
      }
    }
    if (best < 0 || bestD < FLOOD_MIN_SPACING_M) break;
    chosen.push(best);
  }
  return chosen.map((node, id) => {
    const px = g.nodeX[node]!;
    const py = g.nodeY[node]!;
    const edges: number[] = [];
    for (let e = 0; e < g.edgeCount; e++) {
      for (let k = g.shapeStart[e]!; k + 1 < g.shapeStart[e + 1]!; k++) {
        if (pointSegmentDistance(px, py, g.shapeXY[2 * k]!, g.shapeXY[2 * k + 1]!, g.shapeXY[2 * k + 2]!, g.shapeXY[2 * k + 3]!) <= FLOOD_CLOSE_RADIUS_M + 1e-9) {
          edges.push(e);
          break;
        }
      }
    }
    return { id, node, edges };
  });
}

/** M2-5 (`assumed`): flood-prone spots lie within 120 m of water, at most 12, at least 80 m apart; each closes edges within 40 m. */
const FLOOD_NEAR_WATER_M = 120;
const FLOOD_MAX_SPOTS = 12;
const FLOOD_MIN_SPACING_M = 80;
const FLOOD_CLOSE_RADIUS_M = 40;
