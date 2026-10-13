import { notImplemented } from '../shared/not-implemented';
import type { IsoDate } from '../config/sources';

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

/** NOAA solar-position algorithm (AD-4) for an IST calendar date. */
export function sunTimesIst(date: IsoDate, lat: number, lon: number): SunTimes {
  return notImplemented('sunTimesIst', date, lat, lon);
}

/** Sun position at a UTC instant given in milliseconds since the Unix epoch. */
export function sunPosition(utcMs: number, lat: number, lon: number): SunPosition {
  return notImplemented('sunPosition', utcMs, lat, lon);
}
