import { notImplemented } from '../shared/not-implemented';

/**
 * The snapshot's local frame: UTM zone 43N (WGS 84) metres minus a fixed origin, x east and y north (AD-3, AD-4).
 */
export interface LocalOrigin {
  readonly zone: 43;
  readonly easting: number;
  readonly northing: number;
}

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface LocalXY {
  readonly x: number;
  readonly y: number;
}

/** Forward transverse Mercator (UTM 43N), within 1 cm of proj4 over the cluster. */
export function latLonToLocal(p: LatLon, origin: LocalOrigin): LocalXY {
  return notImplemented('latLonToLocal', p, origin);
}

/** Inverse transverse Mercator (UTM 43N), within 1 cm of proj4 over the cluster. */
export function localToLatLon(p: LocalXY, origin: LocalOrigin): LatLon {
  return notImplemented('localToLatLon', p, origin);
}
