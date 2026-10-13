import { notImplemented } from '../../../src/shared/not-implemented';
import type { WardKey } from '../../../src/config/calibration';

/** One ward from the OpenCity GBA final ward KML (data-sources §1). Rings are [lon, lat] pairs. */
export interface KmlWard {
  /** e.g. "South", from the KML's `Corporation` field. */
  readonly corporation: string;
  readonly wardId: number;
  readonly name: string;
  readonly population2011: number;
  readonly rings: readonly (readonly (readonly [lon: number, lat: number])[])[];
}

/** Parses every Placemark. Throws if a Placemark lacks Corporation, ward_id, ward_name or TOT_P. */
export function parseWardKml(xml: string): KmlWard[] {
  return notImplemented('parseWardKml', xml);
}

/**
 * Picks the cluster wards by `<corporation>-<ward id>` key (CLUSTER_WARDS) and checks their names. Throws listing
 * every key that is missing or whose name differs.
 */
export function selectClusterWards(all: readonly KmlWard[], keys: readonly { readonly key: WardKey; readonly name: string }[]): (KmlWard & { readonly key: WardKey })[] {
  return notImplemented('selectClusterWards', all, keys);
}
