/**
 * `npm run data:fetch` (architecture AD-3): builds the dated map snapshot in data/snapshot/<YYYY-MM-DD>/.
 *
 * 1. Wards: the OpenCity GBA final ward KML (Dec 2025, public domain) → the 7 cluster wards and their 2011 populations.
 * 2. OSM: roads, buildings, water and parks, and POIs from Overpass, in 2 × 2 bounding-box tiles (area queries time
 *    out on the public servers), with retries and mirror fallback. Raw responses are cached in .cache/ for re-runs.
 * 3. Process: project to UTM 43N minus a local origin, keep what lies within 300 m of the cluster wards, simplify
 *    footprints, and encode.
 * 4. Write the files and a manifest with the queries, counts, coverage and SHA-256 of every file.
 *
 * The build never runs this. Run it by hand, review the manifest diff, and commit the folder.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import proj4 from 'proj4';
import { CLUSTER_WARDS } from '../../src/config/calibration';
import { encodeRings, type Point } from '../../src/geo/quantise';
import {
  BUILDING_KINDS,
  HIGHWAY_CLASSES,
  SNAPSHOT_DATA_FILES,
  encodeSnapshotData,
  type AreaSet,
  type BuildingKind,
  type HighwayClass,
  type Poi,
  type RoadNode,
  type RoadWay,
  type SnapshotManifest,
  type WardShape,
} from '../../src/geo/snapshot';
import { parseWardKml, selectClusterWards } from './lib/kml';
import { OVERPASS_ENDPOINTS, overpassQuery, splitBbox } from './lib/overpass';
import { ringArea, simplifyRing } from './lib/simplify';
import { stitchRings } from './lib/stitch';

const ROOT = resolve(import.meta.dirname, '../..');
const CACHE = join(ROOT, '.cache');
const KML_URL =
  'https://data.opencity.in/dataset/863209cb-4ced-4f51-b5c5-156939c50922/resource/9013d656-8051-4e2d-9648-46efd0d86d3d/download/gba-369-wards-december-2025.kml';
const BUFFER_M = 300;
const MIN_BUILDING_M2 = 12;
const KCDC_WAY = 287_327_441;
const UTM43N = '+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs';
const SKIP_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);

type LatLon = { readonly lat: number; readonly lon: number };
interface OsmElement {
  readonly type: 'node' | 'way' | 'relation';
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly center?: LatLon;
  readonly nodes?: readonly number[];
  readonly geometry?: readonly (LatLon | null)[];
  readonly members?: readonly { readonly type: string; readonly role: string; readonly geometry?: readonly LatLon[] }[];
  readonly tags?: Readonly<Record<string, string>>;
}

const log = (msg: string): void => {
  console.log(`[data:fetch] ${msg}`);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function istToday(): `${number}-${number}-${number}` {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) as `${number}-${number}-${number}`;
}

async function cached(name: string, fetchText: () => Promise<string>): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, name);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const text = await fetchText();
  writeFileSync(file, text);
  return text;
}

const usedEndpoints = new Set<string>();
const queries: string[] = [];

async function overpass(query: string): Promise<OsmElement[]> {
  queries.push(query);
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const text = await cached(`overpass-${key}.json`, async () => {
    const recordingFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, { ...init, signal: AbortSignal.timeout(240_000) });
      if (res.status === 200) usedEndpoints.add(input instanceof Request ? input.url : input.toString());
      return res;
    };
    const json = await overpassQuery(query, { endpoints: OVERPASS_ENDPOINTS, attemptsPerEndpoint: 3, backoffMs: 15_000, fetchFn: recordingFetch, sleep });
    await sleep(2_000);
    return JSON.stringify(json);
  });
  return (JSON.parse(text) as { elements: OsmElement[] }).elements;
}

async function fetchTiled(label: string, body: (bbox: string) => string, tiles: readonly (readonly [number, number, number, number])[]): Promise<OsmElement[]> {
  const byKey = new Map<string, OsmElement>();
  for (const [i, t] of tiles.entries()) {
    log(`${label}: tile ${i + 1}/${tiles.length}`);
    const elements = await overpass(`[out:json][timeout:180];${body(t.map((v) => v.toFixed(6)).join(','))}`);
    for (const e of elements) {
      const k = `${e.type}/${e.id}`;
      const prev = byKey.get(k);
      // A way's full body may arrive in one tile and only its skeleton in another; keep the richer copy.
      if (!prev || (!prev.tags && e.tags)) byKey.set(k, e);
    }
  }
  return [...byKey.values()];
}

async function main(): Promise<void> {
  // 1. Wards.
  log('downloading the GBA ward KML');
  const kml = await cached('gba-369-wards-december-2025.kml', async () => {
    const res = await fetch(KML_URL, { headers: { 'User-Agent': 'SwachhFleetWorld-data/0.1' } });
    if (!res.ok) throw new Error(`KML download failed: HTTP ${res.status}`);
    return res.text();
  });
  const wards = selectClusterWards(parseWardKml(kml), CLUSTER_WARDS);
  log(`wards: ${wards.map((w) => `${w.key} ${w.name} (${w.population2011})`).join(', ')}`);

  const allLat = wards.flatMap((w) => w.rings.flat().map(([, lat]) => lat));
  const allLon = wards.flatMap((w) => w.rings.flat().map(([lon]) => lon));
  const [s, n, w, e] = [Math.min(...allLat), Math.max(...allLat), Math.min(...allLon), Math.max(...allLon)];
  const padLat = BUFFER_M / 110_574 + 0.0005;
  const padLon = BUFFER_M / (111_320 * Math.cos(((s + n) / 2) * (Math.PI / 180))) + 0.0005;
  const bbox: [number, number, number, number] = [s - padLat, w - padLon, n + padLat, e + padLon];
  const tiles = splitBbox(bbox, 2, 2);

  const centre = proj4('WGS84', UTM43N, [(w + e) / 2, (s + n) / 2]);
  const origin = { zone: 43 as const, easting: Math.round(centre[0]!), northing: Math.round(centre[1]!) };
  const project = (p: LatLon): Point => {
    const [x, y] = proj4('WGS84', UTM43N, [p.lon, p.lat]);
    return [x - origin.easting, y - origin.northing];
  };

  const closeRing = (r: Point[]): Point[] => (r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r : [...r, r[0]!]);
  const wardRings = wards.map((ward) => ward.rings.map((r) => closeRing(r.map(([lon, lat]) => project({ lat, lon })))));
  const inside = (p: Point, ring: readonly Point[]): boolean => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const segDist = ([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  const flatRings = wardRings.flat();
  const ringBoxes = flatRings.map((r) => [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))]);
  /** Within BUFFER_M of the cluster wards. */
  const inRegion = (p: Point): boolean =>
    flatRings.some((ring, i) => {
      const [x0, y0, x1, y1] = ringBoxes[i]!;
      if (p[0] < x0! - BUFFER_M || p[0] > x1! + BUFFER_M || p[1] < y0! - BUFFER_M || p[1] > y1! + BUFFER_M) return false;
      if (inside(p, ring)) return true;
      for (let k = 0; k + 1 < ring.length; k++) if (segDist(p, ring[k]!, ring[k + 1]!) <= BUFFER_M) return true;
      return false;
    });
  const wardOf = (p: Point): number => wardRings.findIndex((rings) => rings.some((r) => inside(p, r)));

  // 2. OSM.
  const roadEls = await fetchTiled(
    'roads',
    (b) =>
      `way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$"]["area"!="yes"]["access"!~"^(private|no)$"](${b});out body qt;>;out skel qt;`,
    tiles,
  );
  const buildingEls = await fetchTiled('buildings', (b) => `way["building"](${b});out tags geom qt;`, tiles);
  const areaEls = await fetchTiled(
    'water and parks',
    (b) => `(way["natural"="water"](${b});relation["natural"="water"](${b});way["leisure"="park"](${b});relation["leisure"="park"](${b}););out tags geom qt;`,
    tiles,
  );
  const poiEls = await fetchTiled(
    'points of interest',
    (b) =>
      `(nwr["amenity"="recycling"]["recycling_type"="centre"](${b});nwr["amenity"="marketplace"](${b});node["place"~"^(suburb|neighbourhood|quarter)$"](${b});node["shop"](${b});way(${KCDC_WAY}););out tags center qt;`,
    tiles,
  );

  // 3a. Roads.
  const nodePos = new Map<number, Point>();
  for (const el of roadEls) if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) nodePos.set(el.id, project({ lat: el.lat, lon: el.lon }));
  const ways: RoadWay[] = [];
  for (const el of roadEls) {
    if (el.type !== 'way' || !el.tags || !el.nodes) continue;
    const t = el.tags;
    if (t.service && SKIP_SERVICE.has(t.service)) continue;
    const highway = (t.highway ?? '').replace(/_link$/, '') as HighwayClass;
    if (!HIGHWAY_CLASSES.includes(highway)) continue;
    if (!el.nodes.every((id) => nodePos.has(id))) continue;
    if (!el.nodes.some((id) => inRegion(nodePos.get(id)!))) continue;
    const ow = t.oneway;
    const oneway: RoadWay['oneway'] = ow === 'yes' || ow === '1' || ow === 'true' || t.junction === 'roundabout' ? 'yes' : ow === '-1' || ow === 'reverse' ? '-1' : 'no';
    const lanes = Number.parseInt(t.lanes ?? '', 10);
    const speed = Number.parseInt(t.maxspeed ?? '', 10);
    ways.push({
      id: el.id,
      nodes: el.nodes,
      highway,
      oneway,
      ...(lanes >= 1 && lanes <= 12 ? { lanes } : {}),
      ...(speed >= 5 && speed <= 120 ? { maxspeedKmh: speed } : {}),
      ...(t.name ? { name: t.name } : {}),
    });
  }
  const usedNodes = new Set(ways.flatMap((wy) => wy.nodes));
  const nodes: RoadNode[] = [...usedNodes].sort((a, b) => a - b).map((id) => ({ id, x: nodePos.get(id)![0], y: nodePos.get(id)![1] }));
  log(`roads: ${ways.length} ways, ${nodes.length} nodes`);

  // 3b. Buildings.
  const kindOf = (b: string): BuildingKind => {
    if (['house', 'detached', 'bungalow', 'semidetached_house', 'terrace'].includes(b)) return 'house';
    if (b === 'apartments' || b === 'dormitory') return 'apartments';
    if (b === 'residential') return 'residential';
    if (['commercial', 'office', 'hotel'].includes(b)) return 'commercial';
    if (['retail', 'supermarket', 'kiosk', 'shop'].includes(b)) return 'retail';
    if (['industrial', 'warehouse', 'factory'].includes(b)) return 'industrial';
    if (['public', 'school', 'hospital', 'government', 'civic', 'university', 'college', 'temple', 'church', 'mosque', 'religious'].includes(b)) return 'public';
    return 'other';
  };
  const bRings: Point[][] = [];
  const levels: number[] = [];
  const heights: number[] = [];
  const kinds: number[] = [];
  const perWard = new Array<number>(wards.length).fill(0);
  for (const el of buildingEls) {
    if (el.type !== 'way' || !el.geometry || !el.tags) continue;
    const geo = el.geometry.filter((g): g is LatLon => g !== null);
    if (geo.length < 4) continue;
    const pts = geo.map(project);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) continue;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (!inRegion([cx, cy])) continue;
    const ring = simplifyRing(pts, 0.5);
    if (ringArea(ring) < MIN_BUILDING_M2) continue;
    const lv = Math.round(Number.parseFloat(el.tags['building:levels'] ?? ''));
    const h = Number.parseFloat(el.tags.height ?? '');
    bRings.push(ring);
    levels.push(lv >= 1 && lv <= 60 ? lv : 0);
    heights.push(h > 0 && h < 300 ? Math.round(h * 10) : 0);
    kinds.push(BUILDING_KINDS.indexOf(kindOf(el.tags.building ?? 'yes')));
    const wi = wardOf([cx, cy]);
    if (wi >= 0) perWard[wi]!++;
  }
  log(`buildings: ${bRings.length}`);

  // 3c. Water and parks.
  const aRings: Point[][] = [];
  const aKinds: number[] = [];
  const within = (r: readonly Point[]): boolean => r.every(([x, y]) => Math.abs(x) < 8000 && Math.abs(y) < 8000);
  for (const el of areaEls) {
    const kind = el.tags?.natural === 'water' ? 0 : el.tags?.leisure === 'park' ? 1 : -1;
    if (kind < 0) continue;
    const latlonRings =
      el.type === 'way' && el.geometry
        ? [el.geometry.filter((g): g is LatLon => g !== null)]
        : stitchRings((el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry!));
    for (const llr of latlonRings) {
      if (llr.length < 4) continue;
      const pts = llr.map(project);
      const f = pts[0]!;
      const l = pts[pts.length - 1]!;
      if (f[0] !== l[0] || f[1] !== l[1]) continue;
      if (!within(pts) || !pts.some(inRegion)) continue;
      const ring = simplifyRing(pts, 1);
      if (ringArea(ring) < 50) continue;
      aRings.push(ring);
      aKinds.push(kind);
    }
  }
  log(`water and parks: ${aRings.length}`);

  // 3d. POIs.
  const pois: Poi[] = [];
  for (const el of poiEls) {
    const ll = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
    if (!ll || !el.tags) continue;
    const [x, y] = project(ll);
    const t = el.tags;
    const kind: Poi['kind'] | null =
      el.type === 'way' && el.id === KCDC_WAY
        ? 'kcdc'
        : t.amenity === 'recycling'
          ? 'recycling-centre'
          : t.amenity === 'marketplace'
            ? 'marketplace'
            : t.place
              ? 'place'
              : t.shop
                ? 'shop'
                : null;
    if (!kind) continue;
    if (kind !== 'kcdc' && !inRegion([x, y])) continue;
    pois.push({ kind, osmId: el.id, name: t['name:en'] ?? t.name ?? null, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  pois.sort((a, b) => a.kind.localeCompare(b.kind) || a.osmId - b.osmId);
  if (!pois.some((p) => p.kind === 'kcdc')) throw new Error('KCDC (way 287327441) was not found');
  log(`POIs: ${pois.length} (${['kcdc', 'recycling-centre', 'marketplace', 'place', 'shop'].map((k) => `${k} ${pois.filter((p) => p.kind === k).length}`).join(', ')})`);

  // 3e. Ward shapes for the map, simplified to 2 m.
  const wardShapes: WardShape[] = wards.map((ward, i) => ({
    key: ward.key,
    name: ward.name,
    population2011: ward.population2011,
    rings: wardRings[i]!.map((r) => simplifyRing(r.map(([x, y]) => [Math.round(x * 4) / 4, Math.round(y * 4) / 4] as Point), 2)),
  }));

  // Coverage: wards whose building density is under 30% of the median are flagged as sparse (R-2).
  const density = wards.map((_, i) => perWard[i]! / Math.max(1, wardRings[i]!.reduce((a, r) => a + ringArea(r), 0) / 1e6));
  const median = [...density].sort((a, b) => a - b)[Math.floor(density.length / 2)]!;
  const sparseWards = wards.filter((_, i) => density[i]! < 0.3 * median).map((ward) => ward.key);

  // 4. Encode and write.
  const areas: AreaSet = { rings: encodeRings(aRings), kind: Uint8Array.from(aKinds) };
  const files = encodeSnapshotData({
    roads: { nodes, ways },
    buildings: { rings: encodeRings(bRings), levels: Uint8Array.from(levels), heightDm: Uint16Array.from(heights), kind: Uint8Array.from(kinds) },
    areas,
    wards: wardShapes,
    pois,
  });
  const date = istToday();
  const dir = join(ROOT, 'data', 'snapshot', date);
  mkdirSync(dir, { recursive: true });
  const fileMeta = {} as Record<(typeof SNAPSHOT_DATA_FILES)[number], { sha256: string; bytes: number }>;
  for (const name of SNAPSHOT_DATA_FILES) {
    const content = files[name];
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    writeFileSync(join(dir, name), bytes);
    fileMeta[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  const manifest: SnapshotManifest = {
    version: 1,
    fetchedAt: date,
    licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    origin,
    bboxes: tiles,
    endpoints: [...usedEndpoints].sort(),
    queries,
    wards: wards.map((ward) => ({ key: ward.key, name: ward.name, population2011: ward.population2011 })),
    counts: { buildings: bRings.length, roadNodes: nodes.length, roadWays: ways.length, areas: aRings.length, pois: pois.length },
    coverage: { buildingsWithLevelsPct: Math.round((1000 * levels.filter((l) => l > 0).length) / Math.max(1, levels.length)) / 10, sparseWards },
    files: fileMeta,
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const total = Object.values(fileMeta).reduce((a, f) => a + f.bytes, 0);
  log(`wrote ${dir} (${(total / 1024).toFixed(0)} KiB); sparse wards: ${sparseWards.join(', ') || 'none'}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
