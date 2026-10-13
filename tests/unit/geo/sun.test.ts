import { describe, expect, it } from 'vitest';
import { sunPosition, sunTimesIst } from '../../../src/geo/sun';
import type { IsoDate } from '../../../src/config/sources';

// Requirements X-2, architecture AD-4. Reference times: timeanddate.com, "Sunrise and sunset times in Bengaluru",
// 2026 tables (times in IST, refraction included), fetched 2026-10-14. Coordinates: Bengaluru city centre.
const BLR = { lat: 12.9716, lon: 77.5946 };
const TOLERANCE_MIN = 2;

const hm = (h: number, m: number): number => h * 60 + m;

const PUBLISHED: readonly { date: IsoDate; sunrise: number; sunset: number; noon: number; noonAltDeg: number }[] = [
  { date: '2026-03-01', sunrise: hm(6, 35), sunset: hm(18, 28), noon: hm(12, 32), noonAltDeg: 69.5 },
  { date: '2026-03-20', sunrise: hm(6, 24), sunset: hm(18, 30), noon: hm(12, 27), noonAltDeg: 76.9 },
  { date: '2026-10-14', sunrise: hm(6, 9), sunset: hm(18, 1), noon: hm(12, 5), noonAltDeg: 0 },
  { date: '2026-12-21', sunrise: hm(6, 36), sunset: hm(17, 58), noon: hm(12, 17), noonAltDeg: 53.6 },
];

/** UTC milliseconds of an IST wall-clock time (tests may use Date; the pure layers may not). */
function istToUtcMs(date: IsoDate, minutes: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 0, minutes) - 330 * 60_000;
}

describe('sunTimesIst', () => {
  it.each(PUBLISHED.map((p) => [p.date, p] as const))('matches the published sunrise and sunset on %s (±2 min)', (_date, p) => {
    const t = sunTimesIst(p.date, BLR.lat, BLR.lon);
    expect(Math.abs(t.sunriseMin - p.sunrise)).toBeLessThanOrEqual(TOLERANCE_MIN);
    expect(Math.abs(t.sunsetMin - p.sunset)).toBeLessThanOrEqual(TOLERANCE_MIN);
  });

  it.each(PUBLISHED.filter((p) => p.date !== '2026-10-14').map((p) => [p.date, p] as const))('matches the published solar noon on %s (±2 min)', (_date, p) => {
    expect(Math.abs(sunTimesIst(p.date, BLR.lat, BLR.lon).solarNoonMin - p.noon)).toBeLessThanOrEqual(TOLERANCE_MIN);
  });

  it('orders sunrise < solar noon < sunset', () => {
    const t = sunTimesIst('2026-10-14', BLR.lat, BLR.lon);
    expect(t.sunriseMin).toBeLessThan(t.solarNoonMin);
    expect(t.solarNoonMin).toBeLessThan(t.sunsetMin);
  });
});

describe('sunPosition', () => {
  it.each(PUBLISHED.filter((p) => p.noonAltDeg > 0).map((p) => [p.date, p] as const))('gives the published noon altitude on %s (±0.5°)', (_date, p) => {
    const pos = sunPosition(istToUtcMs(p.date, p.noon), BLR.lat, BLR.lon);
    expect(Math.abs(pos.altitudeDeg - p.noonAltDeg)).toBeLessThanOrEqual(0.5);
  });

  it('is below the horizon at midnight IST', () => {
    expect(sunPosition(istToUtcMs('2026-10-14', 0), BLR.lat, BLR.lon).altitudeDeg).toBeLessThan(-30);
  });

  it('rises in the east and sets in the west at the equinox', () => {
    const rise = sunPosition(istToUtcMs('2026-03-20', hm(6, 24)), BLR.lat, BLR.lon);
    const set = sunPosition(istToUtcMs('2026-03-20', hm(18, 30)), BLR.lat, BLR.lon);
    expect(Math.abs(rise.azimuthDeg - 90)).toBeLessThan(3);
    expect(Math.abs(set.azimuthDeg - 270)).toBeLessThan(3);
  });

  it('stays in the southern sky at the December solstice noon', () => {
    const pos = sunPosition(istToUtcMs('2026-12-21', hm(12, 17)), BLR.lat, BLR.lon);
    expect(Math.abs(pos.azimuthDeg - 180)).toBeLessThan(5);
  });

  it('returns azimuths in [0, 360)', () => {
    for (let m = 0; m < 1440; m += 37) {
      const { azimuthDeg } = sunPosition(istToUtcMs('2026-06-21', m), BLR.lat, BLR.lon);
      expect(azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(azimuthDeg).toBeLessThan(360);
    }
  });
});
