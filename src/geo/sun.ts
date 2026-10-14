import type { IsoDate } from '../config/sources';
import { daysFromCivil, parseCivil } from '../shared/civil';

/** Minutes after local midnight, IST. Sunrise and sunset include standard refraction (upper limb at −0.833°). */
export interface SunTimes {
  readonly sunriseMin: number;
  readonly sunsetMin: number;
  readonly solarNoonMin: number;
}

export interface SunPosition {
  /** Degrees above the horizon, with refraction ignored. Negative at night. */
  readonly altitudeDeg: number;
  /** Degrees clockwise from true north, 0–360. */
  readonly azimuthDeg: number;
}

const RAD = Math.PI / 180;
const IST_HOURS = 5.5;
const MS_PER_DAY = 86_400_000;

interface SolarParams {
  readonly declRad: number;
  /** Equation of time, minutes. */
  readonly eqTimeMin: number;
}

/** NOAA solar calculator (Meeus) for a Julian date. */
function solarParams(julianDay: number): SolarParams {
  const t = (julianDay - 2_451_545) / 36_525;
  const l0 = (((280.46646 + t * (36_000.76983 + 0.0003032 * t)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const appLong = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declRad = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const l0r = l0 * RAD;
  const mr = m * RAD;
  const eqTimeMin =
    (4 / RAD) *
    (y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
  return { declRad, eqTimeMin };
}

const julianFromUtcMs = (ms: number): number => ms / MS_PER_DAY + 2_440_587.5;

/** Julian date at a given IST minute of an IST calendar date. */
function julianAtIst(date: IsoDate, minutes: number): number {
  const parts = parseCivil(date);
  if (!parts) throw new RangeError(`Not a date: ${date}`);
  const utcMs = daysFromCivil(...parts) * MS_PER_DAY + (minutes - IST_HOURS * 60) * 60_000;
  return julianFromUtcMs(utcMs);
}

/** Solar noon (IST minutes) for the given parameters. */
const noonMin = (lon: number, p: SolarParams): number => 720 - 4 * lon - p.eqTimeMin + IST_HOURS * 60;

/** Hour angle (degrees) of the upper limb at −0.833°, the standard sunrise and sunset altitude. */
function sunriseHourAngleDeg(lat: number, declRad: number): number {
  const latR = lat * RAD;
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(latR) * Math.cos(declRad)) - Math.tan(latR) * Math.tan(declRad);
  return Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD;
}

/** NOAA solar-position algorithm (AD-4) for an IST calendar date. */
export function sunTimesIst(date: IsoDate, lat: number, lon: number): SunTimes {
  let noon = noonMin(lon, solarParams(julianAtIst(date, 720)));
  const noonParams = solarParams(julianAtIst(date, noon));
  noon = noonMin(lon, noonParams);
  // Refine sunrise and sunset with the sun's parameters at those moments.
  const event = (sign: -1 | 1): number => {
    let t = noon + sign * 4 * sunriseHourAngleDeg(lat, noonParams.declRad);
    for (let i = 0; i < 2; i++) {
      const p = solarParams(julianAtIst(date, t));
      t = noonMin(lon, p) + sign * 4 * sunriseHourAngleDeg(lat, p.declRad);
    }
    return t;
  };
  return { sunriseMin: event(-1), sunsetMin: event(1), solarNoonMin: noon };
}

/** Sun position at a UTC instant given in milliseconds since the Unix epoch. */
export function sunPosition(utcMs: number, lat: number, lon: number): SunPosition {
  const { declRad, eqTimeMin } = solarParams(julianFromUtcMs(utcMs));
  const utcMinutes = (((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60_000;
  const trueSolarMin = (((utcMinutes + eqTimeMin + 4 * lon) % 1440) + 1440) % 1440;
  let hourAngle = trueSolarMin / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const latR = lat * RAD;
  const cosZenith = Math.sin(latR) * Math.sin(declRad) + Math.cos(latR) * Math.cos(declRad) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const denom = Math.cos(latR) * Math.sin(zenith);
  let azimuth: number;
  if (Math.abs(denom) < 1e-12) {
    azimuth = 180;
  } else {
    const cosAz = Math.max(-1, Math.min(1, (Math.sin(latR) * Math.cos(zenith) - Math.sin(declRad)) / denom));
    const a = Math.acos(cosAz) / RAD;
    azimuth = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { altitudeDeg: 90 - zenith / RAD, azimuthDeg: azimuth };
}
