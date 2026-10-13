import fc from 'fast-check';
import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { latLonToLocal, localToLatLon, type LocalOrigin } from '../../../src/geo/project';

// Architecture AD-4: our transverse Mercator agrees with proj4's UTM 43N within 1 cm over the cluster.

const UTM43N = '+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs';
function toUtm(lat: number, lon: number): [number, number] {
  const out: number[] = proj4('WGS84', UTM43N, [lon, lat]);
  return [out[0]!, out[1]!];
}

const CENTRE = { lat: 12.918, lon: 77.635 };
const [E0, N0] = toUtm(CENTRE.lat, CENTRE.lon);
const ORIGIN: LocalOrigin = { zone: 43, easting: E0, northing: N0 };

/** Cluster box with a margin: 12.88–12.96 N, 77.59–77.68 E. */
const clusterPoint = fc.record({
  lat: fc.double({ min: 12.88, max: 12.96, noNaN: true }),
  lon: fc.double({ min: 77.59, max: 77.68, noNaN: true }),
});

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((CENTRE.lat * Math.PI) / 180);

describe('latLonToLocal', () => {
  it('maps the origin to (0, 0)', () => {
    const p = latLonToLocal(CENTRE, ORIGIN);
    expect(Math.abs(p.x)).toBeLessThan(0.01);
    expect(Math.abs(p.y)).toBeLessThan(0.01);
  });

  it('agrees with proj4 within 1 cm', () => {
    fc.assert(
      fc.property(clusterPoint, ({ lat, lon }) => {
        const [e, n] = toUtm(lat, lon);
        const p = latLonToLocal({ lat, lon }, ORIGIN);
        expect(Math.abs(p.x - (e - E0))).toBeLessThan(0.01);
        expect(Math.abs(p.y - (n - N0))).toBeLessThan(0.01);
      }),
      { numRuns: 300 },
    );
  });

  it('puts KCDC south-east of the cluster centre', () => {
    const p = latLonToLocal({ lat: 12.89558, lon: 77.64916 }, ORIGIN);
    expect(p.x).toBeGreaterThan(1000);
    expect(p.y).toBeLessThan(-2000);
  });
});

describe('localToLatLon', () => {
  it('inverts proj4 within 1 cm', () => {
    fc.assert(
      fc.property(clusterPoint, ({ lat, lon }) => {
        const [e, n] = toUtm(lat, lon);
        const back = localToLatLon({ x: e - E0, y: n - N0 }, ORIGIN);
        expect(Math.abs(back.lat - lat) * M_PER_DEG_LAT).toBeLessThan(0.01);
        expect(Math.abs(back.lon - lon) * M_PER_DEG_LON).toBeLessThan(0.01);
      }),
      { numRuns: 300 },
    );
  });

  it('round-trips with latLonToLocal', () => {
    fc.assert(
      fc.property(clusterPoint, (p) => {
        const back = localToLatLon(latLonToLocal(p, ORIGIN), ORIGIN);
        expect(Math.abs(back.lat - p.lat) * M_PER_DEG_LAT).toBeLessThan(0.001);
        expect(Math.abs(back.lon - p.lon) * M_PER_DEG_LON).toBeLessThan(0.001);
      }),
    );
  });
});
