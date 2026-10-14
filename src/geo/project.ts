/**
 * The snapshot's local frame: UTM zone 43N (WGS 84) metres minus a fixed origin, x east and y north (AD-3, AD-4).
 * Transverse Mercator by Krüger's series to order n⁴ (Karney 2011), accurate to well under a millimetre here.
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

const A_AXIS = 6_378_137;
const FLATTENING = 1 / 298.257223563;
const K0 = 0.9996;
const FALSE_EASTING = 500_000;
const RAD = Math.PI / 180;

const n = FLATTENING / (2 - FLATTENING);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const RECT_A = (A_AXIS / (1 + n)) * (1 + n2 / 4 + n4 / 64);
const ALPHA = [n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180, (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440, (61 * n3) / 240 - (103 * n4) / 140, (49_561 * n4) / 161_280];
const BETA = [n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360, n2 / 48 + n3 / 15 - (437 * n4) / 1440, (17 * n3) / 480 - (37 * n4) / 840, (4397 * n4) / 161_280];
const DELTA = [2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45, (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45, (56 * n3) / 15 - (136 * n4) / 35, (4279 * n4) / 630];
const E_FACTOR = (2 * Math.sqrt(n)) / (1 + n);

function centralMeridian(zone: number): number {
  return (zone * 6 - 183) * RAD;
}

/** Forward transverse Mercator (UTM 43N), within 1 cm of proj4 over the cluster. */
export function latLonToLocal(p: LatLon, origin: LocalOrigin): LocalXY {
  const phi = p.lat * RAD;
  const dLambda = p.lon * RAD - centralMeridian(origin.zone);
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - E_FACTOR * Math.atanh(E_FACTOR * sinPhi));
  const xiP = Math.atan2(t, Math.cos(dLambda));
  const etaP = Math.atanh(Math.sin(dLambda) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    xi += a * Math.sin(j * xiP) * Math.cosh(j * etaP);
    eta += a * Math.cos(j * xiP) * Math.sinh(j * etaP);
  });
  return { x: FALSE_EASTING + K0 * RECT_A * eta - origin.easting, y: K0 * RECT_A * xi - origin.northing };
}

/** Inverse transverse Mercator (UTM 43N), within 1 cm of proj4 over the cluster. */
export function localToLatLon(p: LocalXY, origin: LocalOrigin): LatLon {
  const xi = (p.y + origin.northing) / (K0 * RECT_A);
  const eta = (p.x + origin.easting - FALSE_EASTING) / (K0 * RECT_A);
  let xiP = xi;
  let etaP = eta;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xiP -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    etaP -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  DELTA.forEach((d, i) => {
    phi += d * Math.sin(2 * (i + 1) * chi);
  });
  const lambda = centralMeridian(origin.zone) + Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { lat: phi / RAD, lon: lambda / RAD };
}
