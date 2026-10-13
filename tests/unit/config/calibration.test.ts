import { describe, expect, it } from 'vitest';
import { CLUSTER_WARDS, getCalibration } from '../../../src/config/calibration';

// The real config matches docs/data-sources.md (§1a, §2, §3, §4, assumptions log).

describe('calibration config', () => {
  it('holds the 7 wards with their Census 2011 populations (§1a)', () => {
    const { population2011ByWard: p } = getCalibration();
    expect(p.tag).toBe('real');
    expect(p.sourceIds).toContain('gba-wards-dec2025');
    expect(Object.keys(p.value).sort()).toEqual(CLUSTER_WARDS.map((w) => w.key).sort());
    expect(p.value).toEqual({
      'South-29': 27_879,
      'South-28': 22_885,
      'South-30': 25_594,
      'South-72': 18_787,
      'South-71': 18_836,
      'South-68': 23_783,
      'South-69': 18_834,
    });
  });

  it('uses the published city-wide figures, tagged real (§2)', () => {
    const c = getCalibration();
    expect(c.cityWasteTpd).toMatchObject({ value: 5_500, tag: 'real' });
    expect(c.householdsPerAutoTipper).toMatchObject({ value: 1_000, tag: 'real' });
    expect(c.cityBlackSpots).toMatchObject({ value: 1_555, tag: 'real' });
  });

  it('uses the TomTom 2025 rush-hour speeds (§4)', () => {
    const c = getCalibration();
    expect(c.morningPeakSpeedKmh).toMatchObject({ value: 14.6, tag: 'real', sourceIds: ['tomtom-2025'] });
    expect(c.eveningPeakSpeedKmh).toMatchObject({ value: 13.2, tag: 'real', sourceIds: ['tomtom-2025'] });
  });

  it('keeps every published KCDC figure, defaulting to 100 t/day (P-4, §3)', () => {
    const k = getCalibration().kcdcIntakeCapTpd;
    expect(k.value).toBe(100);
    expect(k.tag).toBe('real');
    expect((k.alternatives ?? []).map((a) => a.value).sort((a, b) => a - b)).toEqual([60, 150, 500]);
  });

  it('labels the unverified placeholders as assumed (assumptions log)', () => {
    const c = getCalibration();
    for (const f of [c.growthFactor2011to2026, c.cityPopulation2026, c.personsPerHousehold, c.compactorPayloadT, c.transferPoints, c.smartBins]) {
      expect(f.tag).toBe('assumed');
    }
    expect(c.growthFactor2011to2026.value).toBe(1.6);
    expect(c.personsPerHousehold.value).toBe(3.9);
    expect(c.transferPoints.value).toBe(5);
    expect(c.smartBins.value).toBe(120);
  });

  it('has a waste composition that sums to 1', () => {
    const { wet, dry, reject } = getCalibration().wasteComposition.value;
    expect(wet + dry + reject).toBeCloseTo(1, 10);
    expect({ wet, dry, reject }).toEqual({ wet: 0.6, dry: 0.3, reject: 0.1 });
  });

  it('derives the default absence rate from the 200–300 absent vehicles a day (~5%)', () => {
    const a = getCalibration().tipperAbsenceRate;
    expect(a.value).toBe(0.05);
    expect(a.sourceIds).toContain('dh-absent-vehicles');
  });
});
