import { notImplemented } from '../shared/not-implemented';
import type { IsoDate } from '../config/sources';
import type { WardKey } from '../config/calibration';
import type { EncodedRings, Point } from './quantise';
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

/**
 * Encodes everything except the manifest (whose `files` hashes the fetch script computes). Road node coordinates
 * are quantised like everything else.
 */
export function encodeSnapshotData(data: Omit<DecodedSnapshot, 'manifest'>): Omit<SnapshotFiles, 'manifest.json'> {
  return notImplemented('encodeSnapshotData', data);
}

/** Throws if a file is malformed or the manifest version is unknown. */
export function decodeSnapshot(files: SnapshotFiles): DecodedSnapshot {
  return notImplemented('decodeSnapshot', files);
}
