import { describe, expect, it } from 'vitest';
import type { WardShape } from '../../../src/geo/snapshot';
import { facilityCentre } from '../../../src/render/agents';
import { FLOAT_AMPLITUDE, FLOAT_PERIOD_S, floatOffset, labelOpacity, labelPixelHeight, placeLabels, worldHeightForPixels } from '../../../src/render/labels';
import type { FacilityView } from '../../../src/workers/protocol';

// Requirement W-8 and architecture §9.2 (CR-2): floating 3D place labels.

const square = (x0: number, y0: number, size: number): [number, number][] => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
];
const ward = (key: string, name: string, x0: number): WardShape => ({ key, name, population2011: 1000, rings: [square(x0, 0, 100)] }) as unknown as WardShape;

const WARDS: WardShape[] = [ward('South-72', 'HSR Layout', 0), ward('South-28', 'Kormangala East', 200), ward('South-29', 'Kormangala West', 400)];
const FACILITIES: FacilityView[] = [
  { kind: 'depot', id: 0, displayId: 'DEPOT-S-01', name: 'Vehicle depot', x: 10, y: 10, location: 'assumed' },
  { kind: 'transfer-point', id: 0, displayId: 'TP-01', name: 'Secondary transfer point', x: 50, y: 50, location: 'assumed' },
  { kind: 'transfer-point', id: 1, displayId: 'TP-02', name: 'Secondary transfer point', x: 5000, y: 5000, location: 'assumed' },
  { kind: 'kcdc', id: 0, displayId: 'KCDC', name: 'KCDC compost plant, Kudlu Gate', x: 1000, y: 1000, location: 'real' },
  { kind: 'weighbridge', id: 0, displayId: 'WB-KCDC', name: 'Weighbridge at KCDC', x: 1000, y: 1000, location: 'assumed' },
];

describe('placeLabels', () => {
  const all = () => placeLabels({ wards: WARDS, facilities: FACILITIES });
  const byText = (t: string) => all().find((l) => l.text === t);

  it('labels the two areas where the area buttons fly to', () => {
    const areas = all().filter((l) => l.group === 'area');
    expect(areas.map((l) => l.text)).toEqual(['HSR Layout', 'Koramangala']);
    expect(byText('HSR Layout')).toMatchObject({ x: 50, y: 50 });
    expect(byText('Koramangala')).toMatchObject({ x: 350, y: 50 });
  });

  it('labels every ward as "South-NN · Name" at its centre', () => {
    const wards = all().filter((l) => l.group === 'ward');
    expect(wards.map((l) => l.text)).toEqual(['South-72 · HSR Layout', 'South-28 · Kormangala East', 'South-29 · Kormangala West']);
    expect(byText('South-28 · Kormangala East')).toMatchObject({ x: 250, y: 50 });
  });

  it('labels transfer points with their ward (or the nearest one), and KCDC, at the facility block', () => {
    const facilities = all().filter((l) => l.group === 'facility');
    expect(facilities.map((l) => l.text)).toEqual(['TP-01 · HSR Layout', 'TP-02 · Kormangala West', 'KCDC Kudlu Gate']);
    const tp = facilityCentre(FACILITIES[1]!);
    expect(byText('TP-01 · HSR Layout')).toMatchObject({ x: tp.x, y: tp.y });
    const k = facilityCentre(FACILITIES[3]!);
    expect(byText('KCDC Kudlu Gate')).toMatchObject({ x: k.x, y: k.y });
  });
});

describe('labelOpacity (zoom bands)', () => {
  it('shows only area names at the overview', () => {
    expect(labelOpacity('area', 5800)).toBe(1);
    expect(labelOpacity('ward', 5800)).toBe(0);
    expect(labelOpacity('facility', 5800)).toBe(0);
  });

  it('shows ward and facility names at the HSR fly-to distance', () => {
    expect(labelOpacity('area', 2200)).toBe(0);
    expect(labelOpacity('ward', 2200)).toBe(1);
    expect(labelOpacity('facility', 2200)).toBe(1);
  });

  it('keeps only facility names close up', () => {
    expect(labelOpacity('ward', 700)).toBe(0);
    expect(labelOpacity('facility', 100)).toBe(1);
  });

  it('fades linearly at the band edges', () => {
    expect(labelOpacity('area', 4100)).toBeCloseTo(0.5);
    expect(labelOpacity('area', 3800)).toBe(0);
    expect(labelOpacity('ward', 4100)).toBeCloseTo(0.5);
    expect(labelOpacity('ward', 900)).toBeCloseTo(0.5);
    expect(labelOpacity('facility', 2600)).toBeCloseTo(0.5);
    expect(labelOpacity('facility', 3000)).toBe(0);
  });
});

describe('label size', () => {
  it('uses the base size at the reference distance', () => {
    expect(labelPixelHeight('area', 2000)).toBeCloseTo(30);
    expect(labelPixelHeight('ward', 2000)).toBeCloseTo(22);
    expect(labelPixelHeight('facility', 2000)).toBeCloseTo(18);
  });

  it('grows as the label gets nearer, within 0.7–1.4 × the base', () => {
    let prev = 0;
    for (let d = 20_000; d >= 50; d *= 0.8) {
      const px = labelPixelHeight('ward', d);
      expect(px).toBeGreaterThanOrEqual(prev);
      expect(px).toBeGreaterThanOrEqual(0.7 * 22 - 1e-9);
      expect(px).toBeLessThanOrEqual(1.4 * 22 + 1e-9);
      prev = px;
    }
    expect(labelPixelHeight('ward', 50)).toBeCloseTo(1.4 * 22);
    expect(labelPixelHeight('ward', 20_000)).toBeCloseTo(0.7 * 22);
  });

  it('converts pixels to metres at the label distance', () => {
    expect(worldHeightForPixels(20, 1000, 60, 800)).toBeCloseTo((20 * 2 * 1000 * Math.tan(Math.PI / 6)) / 800);
    expect(worldHeightForPixels(20, 2000, 60, 800)).toBeCloseTo(2 * worldHeightForPixels(20, 1000, 60, 800));
  });
});

describe('floatOffset', () => {
  it('bobs within the amplitude, with a period of FLOAT_PERIOD_S', () => {
    for (let t = 0; t < 10; t += 0.13) {
      const o = floatOffset(t, 3, 40, false);
      expect(Math.abs(o)).toBeLessThanOrEqual(FLOAT_AMPLITUDE * 40 + 1e-9);
      expect(floatOffset(t + FLOAT_PERIOD_S, 3, 40, false)).toBeCloseTo(o);
    }
  });

  it('is out of phase between labels, so they do not bob in step', () => {
    expect(floatOffset(1, 0, 40, false)).not.toBeCloseTo(floatOffset(1, 1, 40, false));
  });

  it('stays still under reduced motion', () => {
    for (let t = 0; t < 5; t += 0.5) expect(floatOffset(t, 2, 40, true)).toBe(0);
  });
});
