import { notImplemented } from '../shared/not-implemented';

/** Provenance tags (requirements P-1, data-sources "Provenance tags"). */
export type Tag = 'real' | 'derived' | 'assumed' | 'synthetic';
export const TAGS: readonly Tag[] = ['real', 'derived', 'assumed', 'synthetic'];

/** ISO calendar date, e.g. "2026-10-14". */
export type IsoDate = `${number}-${number}-${number}`;

/**
 * Every source the app may cite. This list must match the "Source IDs" table in docs/data-sources.md exactly,
 * in both directions (architecture AD-9, tests/arch/provenance-docs.test.ts).
 */
export const SOURCE_IDS = [
  'osm-snapshot',
  'gba-wards-dec2025',
  'bswml-dh-5500tpd',
  'bpac-2023-collection',
  'bbmp-autotipper-ratio',
  'dh-absent-vehicles',
  'dh-compactors-580',
  'shubra-blackspots-1555',
  'citizenmatters-door-to-door',
  'kcdc-capacity',
  'tomtom-2025',
  'iieta-mumbai-2025',
  'kasaflow-assumptions',
  'kasaflow-simulation',
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

export interface SourceMeta {
  readonly id: SourceId;
  readonly title: string;
  /** Public URL, or null for the app's own assumption log and simulation. */
  readonly url: string | null;
  /** The tag a figure taken from this source carries. */
  readonly tag: Tag;
  /** When the source was published or fetched. */
  readonly asOf: IsoDate;
}

export function sourceMeta(id: SourceId): SourceMeta {
  return notImplemented('sourceMeta', id);
}
