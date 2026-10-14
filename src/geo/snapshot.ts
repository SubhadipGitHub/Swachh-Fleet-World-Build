import type { IsoDate } from '../config/sources';
import type { WardKey } from '../config/calibration';
import { BinReader, BinWriter } from './binary';
import { decodeRings, encodeRings, type EncodedRings, type Point } from './quantise';
import type { LocalOrigin } from './project';

/** OSM `highway` values kept as drivable roads (AD-3). */
export const HIGHWAY_CLASSES = [
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
] as const;
export type HighwayClass = (typeof HIGHWAY_CLASSES)[number];

export interface RoadNode {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface RoadWay {
  readonly id: number;
  readonly nodes: readonly number[];
  readonly highway: HighwayClass;
  readonly oneway: 'no' | 'yes' | '-1';
  readonly lanes?: number;
  readonly maxspeedKmh?: number;
  readonly name?: string;
}

/** Raw road network in local metres, as fetched (before graph building). */
export interface RoadNetworkInput {
  readonly nodes: readonly RoadNode[];
  readonly ways: readonly RoadWay[];
}

export const BUILDING_KINDS = ['other', 'house', 'apartments', 'residential', 'commercial', 'retail', 'industrial', 'public'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/** One outer ring per building. `levels` and `heightDm` are 0 when OSM has no value. */
export interface BuildingSet {
  readonly rings: EncodedRings;
  readonly levels: Uint8Array;
  readonly heightDm: Uint16Array;
  /** Index into BUILDING_KINDS. */
  readonly kind: Uint8Array;
}

export const AREA_KINDS = ['water', 'park'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export interface AreaSet {
  readonly rings: EncodedRings;
  /** Index into AREA_KINDS. */
  readonly kind: Uint8Array;
}

export interface Poi {
  readonly kind: 'kcdc' | 'recycling-centre' | 'marketplace' | 'shop' | 'place';
  readonly osmId: number;
  readonly name: string | null;
  readonly x: number;
  readonly y: number;
}

export interface WardShape {
  readonly key: WardKey;
  readonly name: string;
  readonly population2011: number;
  readonly rings: readonly (readonly Point[])[];
}

export interface SnapshotManifest {
  readonly version: 1;
  readonly fetchedAt: IsoDate;
  readonly licence: 'ODbL-1.0';
  readonly attribution: '© OpenStreetMap contributors';
  readonly origin: LocalOrigin;
  /** [south, west, north, east] in degrees, one per Overpass tile. */
  readonly bboxes: readonly (readonly [number, number, number, number])[];
  readonly endpoints: readonly string[];
  readonly queries: readonly string[];
  readonly wards: readonly { readonly key: WardKey; readonly name: string; readonly population2011: number }[];
  readonly counts: {
    readonly buildings: number;
    readonly roadNodes: number;
    readonly roadWays: number;
    readonly areas: number;
    readonly pois: number;
  };
  readonly coverage: {
    readonly buildingsWithLevelsPct: number;
    readonly sparseWards: readonly WardKey[];
  };
  /** SHA-256 (hex) and byte length of every other file in the snapshot folder (P-3). */
  readonly files: Readonly<Record<SnapshotFileName, { readonly sha256: string; readonly bytes: number }>>;
}

export const SNAPSHOT_DATA_FILES = ['roads.bin', 'buildings.bin', 'areas.bin', 'wards.json', 'pois.json'] as const;
export type SnapshotFileName = (typeof SNAPSHOT_DATA_FILES)[number];

export interface DecodedSnapshot {
  readonly manifest: SnapshotManifest;
  readonly roads: RoadNetworkInput;
  readonly buildings: BuildingSet;
  readonly areas: AreaSet;
  readonly wards: readonly WardShape[];
  readonly pois: readonly Poi[];
}

/** The files of one snapshot folder, binary files as bytes and JSON files as text. */
export interface SnapshotFiles {
  readonly 'manifest.json': string;
  readonly 'roads.bin': Uint8Array;
  readonly 'buildings.bin': Uint8Array;
  readonly 'areas.bin': Uint8Array;
  readonly 'wards.json': string;
  readonly 'pois.json': string;
}

const ONEWAY_CODES = ['no', 'yes', '-1'] as const;
const NONE_U8 = 0;
const NO_NAME = 0xffff;

function writeRings(w: BinWriter, rings: EncodedRings): void {
  const count = rings.starts.length - 1;
  w.u32(count);
  for (const s of rings.starts) w.u32(s);
  for (const c of rings.coords) w.i16(c);
}

function readRings(r: BinReader): EncodedRings {
  const count = r.u32();
  const starts = new Uint32Array(count + 1);
  for (let i = 0; i <= count; i++) starts[i] = r.u32();
  const coords = new Int16Array(2 * starts[count]!);
  for (let i = 0; i < coords.length; i++) coords[i] = r.i16();
  return { coords, starts };
}

function encodeRoads(roads: RoadNetworkInput): Uint8Array {
  const w = new BinWriter();
  w.magic('KFR1');
  w.u32(roads.nodes.length);
  w.u32(roads.ways.length);
  const index = new Map<number, number>();
  roads.nodes.forEach((n, i) => {
    index.set(n.id, i);
    w.f64(n.id);
  });
  // Node coordinates as one quantised "ring" per node: absolute values, no delta overflow.
  writeRings(w, encodeRings(roads.nodes.map((n) => [[n.x, n.y]])));
  const names: string[] = [];
  const nameIndex = new Map<string, number>();
  for (const way of roads.ways) {
    w.f64(way.id);
    w.u8(HIGHWAY_CLASSES.indexOf(way.highway));
    w.u8(ONEWAY_CODES.indexOf(way.oneway));
    w.u8(way.lanes ?? NONE_U8);
    w.u8(way.maxspeedKmh ?? NONE_U8);
    let ni = NO_NAME;
    if (way.name !== undefined) {
      ni = nameIndex.get(way.name) ?? names.length;
      if (ni === names.length) {
        names.push(way.name);
        nameIndex.set(way.name, ni);
      }
    }
    w.u16(ni);
    w.u32(way.nodes.length);
    for (const id of way.nodes) {
      const i = index.get(id);
      if (i === undefined) throw new RangeError(`Way ${way.id} references unknown node ${id}`);
      w.u32(i);
    }
  }
  w.json(names);
  return w.finish();
}

function decodeRoads(bytes: Uint8Array): RoadNetworkInput {
  const r = new BinReader(bytes);
  r.expectMagic('KFR1');
  const nodeCount = r.u32();
  const wayCount = r.u32();
  const ids: number[] = [];
  for (let i = 0; i < nodeCount; i++) ids.push(r.f64());
  const coords = decodeRings(readRings(r));
  if (coords.length !== nodeCount) throw new RangeError('Road node count mismatch');
  const nodes: RoadNode[] = ids.map((id, i) => ({ id, x: coords[i]![0]![0], y: coords[i]![0]![1] }));
  const raw: { id: number; hw: number; ow: number; lanes: number; speed: number; name: number; nodes: number[] }[] = [];
  for (let i = 0; i < wayCount; i++) {
    const id = r.f64();
    const hw = r.u8();
    const ow = r.u8();
    const lanes = r.u8();
    const speed = r.u8();
    const name = r.u16();
    const n = r.u32();
    const wayNodes: number[] = [];
    for (let k = 0; k < n; k++) {
      const ni = r.u32();
      const node = nodes[ni];
      if (!node) throw new RangeError(`Way ${id} references node index ${ni} out of range`);
      wayNodes.push(node.id);
    }
    raw.push({ id, hw, ow, lanes, speed, name, nodes: wayNodes });
  }
  const names = r.json() as string[];
  r.end();
  const ways: RoadWay[] = raw.map((x) => {
    const highway = HIGHWAY_CLASSES[x.hw];
    const oneway = ONEWAY_CODES[x.ow];
    if (!highway || !oneway) throw new RangeError(`Way ${x.id} has an unknown class or oneway code`);
    return {
      id: x.id,
      nodes: x.nodes,
      highway,
      oneway,
      ...(x.lanes !== NONE_U8 ? { lanes: x.lanes } : {}),
      ...(x.speed !== NONE_U8 ? { maxspeedKmh: x.speed } : {}),
      ...(x.name !== NO_NAME ? { name: names[x.name]! } : {}),
    };
  });
  return { nodes, ways };
}

function encodeBuildings(b: BuildingSet): Uint8Array {
  const w = new BinWriter();
  w.magic('KFB1');
  writeRings(w, b.rings);
  for (const v of b.levels) w.u8(v);
  for (const v of b.heightDm) w.u16(v);
  for (const v of b.kind) w.u8(v);
  return w.finish();
}

function decodeBuildings(bytes: Uint8Array): BuildingSet {
  const r = new BinReader(bytes);
  r.expectMagic('KFB1');
  const rings = readRings(r);
  const n = rings.starts.length - 1;
  const levels = new Uint8Array(n);
  const heightDm = new Uint16Array(n);
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) levels[i] = r.u8();
  for (let i = 0; i < n; i++) heightDm[i] = r.u16();
  for (let i = 0; i < n; i++) kind[i] = r.u8();
  r.end();
  return { rings, levels, heightDm, kind };
}

function encodeAreas(a: AreaSet): Uint8Array {
  const w = new BinWriter();
  w.magic('KFA1');
  writeRings(w, a.rings);
  for (const v of a.kind) w.u8(v);
  return w.finish();
}

function decodeAreas(bytes: Uint8Array): AreaSet {
  const r = new BinReader(bytes);
  r.expectMagic('KFA1');
  const rings = readRings(r);
  const kind = new Uint8Array(rings.starts.length - 1);
  for (let i = 0; i < kind.length; i++) kind[i] = r.u8();
  r.end();
  return { rings, kind };
}

/**
 * Encodes everything except the manifest (whose `files` hashes the fetch script computes). Road node coordinates
 * are quantised like everything else.
 */
export function encodeSnapshotData(data: Omit<DecodedSnapshot, 'manifest'>): Omit<SnapshotFiles, 'manifest.json'> {
  return {
    'roads.bin': encodeRoads(data.roads),
    'buildings.bin': encodeBuildings(data.buildings),
    'areas.bin': encodeAreas(data.areas),
    'wards.json': JSON.stringify(data.wards),
    'pois.json': JSON.stringify(data.pois),
  };
}

/** Throws if a file is malformed or the manifest version is unknown. */
export function decodeSnapshot(files: SnapshotFiles): DecodedSnapshot {
  const manifest = JSON.parse(files['manifest.json']) as SnapshotManifest;
  if ((manifest as { version: unknown }).version !== 1) throw new RangeError(`Unknown snapshot version ${String((manifest as { version: unknown }).version)}`);
  return {
    manifest,
    roads: decodeRoads(files['roads.bin']),
    buildings: decodeBuildings(files['buildings.bin']),
    areas: decodeAreas(files['areas.bin']),
    wards: JSON.parse(files['wards.json']) as WardShape[],
    pois: JSON.parse(files['pois.json']) as Poi[],
  };
}
