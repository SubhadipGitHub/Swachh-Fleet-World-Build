import { describe, expect, it } from 'vitest';
import type { Calibration, Figure, Unit } from '../../../src/config/calibration';
import type { SourceId, Tag } from '../../../src/config/sources';
import { deriveClusterScale, type DerivedFigure } from '../../../src/config/derive';

// Requirements W-5: the cluster's scale is computed from the config. This fixture pins the inputs so the test checks
// the formulas, not the (partly unverified) real config values.

function fig(value: number, unit: Unit, tag: Tag, sourceIds: SourceId[]): Figure {
  return { value, unit, tag, sourceIds, asOf: '2026-10-14', ...(tag === 'assumed' ? { note: 'test fixture value' } : {}) };
}

const CAL: Calibration = {
  population2011ByWard: {
    value: {
      'South-29': 27_879,
      'South-28': 22_885,
      'South-30': 25_594,
      'South-72': 18_787,
      'South-71': 18_836,
      'South-68': 23_783,
      'South-69': 18_834,
    },
    unit: 'people',
    tag: 'real',
    sourceIds: ['gba-wards-dec2025'],
    asOf: '2025-12-01',
  },
  growthFactor2011to2026: fig(1.6, 'factor', 'assumed', ['kasaflow-assumptions']),
  personsPerHousehold: fig(3.9, 'persons/household', 'assumed', ['kasaflow-assumptions']),
  cityWasteTpd: fig(5_500, 't/day', 'real', ['bswml-dh-5500tpd']),
  cityPopulation2026: fig(14_000_000, 'people', 'assumed', ['kasaflow-assumptions']),
  householdsPerAutoTipper: fig(1_000, 'households/vehicle', 'real', ['bbmp-autotipper-ratio']),
  compactorPayloadT: fig(6, 't', 'assumed', ['kasaflow-assumptions']),
  compactorTripsPerDay: fig(3, 'trips/day', 'assumed', ['kasaflow-assumptions']),
  cityBlackSpots: fig(1_555, 'count', 'real', ['shubra-blackspots-1555']),
  wasteComposition: { value: { wet: 0.6, dry: 0.3, reject: 0.1 }, unit: 'composition', tag: 'assumed', sourceIds: ['kasaflow-assumptions'], asOf: '2026-10-14', note: 'test fixture value' },
  transferPoints: fig(5, 'count', 'assumed', ['kasaflow-assumptions']),
  smartBins: fig(120, 'count', 'assumed', ['kasaflow-assumptions']),
  tipperAbsenceRate: fig(0.05, 'fraction', 'derived', ['dh-absent-vehicles']),
  kcdcIntakeCapTpd: fig(100, 't/day', 'real', ['kcdc-capacity']),
  freeFlowRefSpeedKmh: fig(30, 'km/h', 'assumed', ['kasaflow-assumptions']),
  morningPeakSpeedKmh: fig(14.6, 'km/h', 'real', ['tomtom-2025']),
  eveningPeakSpeedKmh: fig(13.2, 'km/h', 'real', ['tomtom-2025']),
};

describe('deriveClusterScale (W-5)', () => {
  const scale = (): ReturnType<typeof deriveClusterScale> => deriveClusterScale(CAL);

  it('sums the 7 wards to the 2011 population', () => {
    expect(scale().population2011.value).toBe(156_598);
  });

  it('projects the population to 2026 with the growth factor', () => {
    expect(scale().population2026.value).toBeCloseTo(250_556.8, 6);
  });

  it('rounds households from population ÷ persons per household', () => {
    expect(scale().households.value).toBe(64_245);
  });

  it('derives per-capita waste from the city total and population', () => {
    expect(scale().perCapitaKgPerDay.value).toBeCloseTo(0.392857, 5);
    expect(scale().wasteTpd.value).toBeCloseTo(98.433, 2);
  });

  it('rounds fleet sizes up so every household and tonne is covered', () => {
    expect(scale().autoTippers.value).toBe(65);
    expect(scale().compactors.value).toBe(6);
  });

  it('scales city black spots by population share', () => {
    expect(scale().blackSpots.value).toBe(28);
  });

  it('tags every result derived, with the union of its inputs as sources and inputs', () => {
    const s = scale();
    const all: DerivedFigure[] = [s.population2011, s.population2026, s.households, s.perCapitaKgPerDay, s.wasteTpd, s.autoTippers, s.compactors, s.blackSpots];
    for (const f of all) {
      expect(f.tag).toBe('derived');
      expect(f.derivedFrom.length).toBeGreaterThan(0);
      expect(new Set(f.sourceIds).size).toBe(f.sourceIds.length);
    }
    expect(s.households.derivedFrom).toEqual(expect.arrayContaining(['population2011ByWard', 'growthFactor2011to2026', 'personsPerHousehold']));
    expect([...s.households.sourceIds].sort()).toEqual(['gba-wards-dec2025', 'kasaflow-assumptions']);
    expect([...s.autoTippers.sourceIds].sort()).toEqual(['bbmp-autotipper-ratio', 'gba-wards-dec2025', 'kasaflow-assumptions']);
    expect(s.blackSpots.derivedFrom).toEqual(expect.arrayContaining(['cityBlackSpots', 'cityPopulation2026']));
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(CAL);
    deriveClusterScale(CAL);
    expect(JSON.stringify(CAL)).toBe(before);
  });
});
