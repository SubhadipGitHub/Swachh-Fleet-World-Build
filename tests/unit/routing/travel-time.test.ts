import { describe, expect, it } from 'vitest';
import { buildGraph, type RoadGraph } from '../../../src/routing/graph';
import { BUCKETS_PER_DAY, BUCKET_SEC, EVENING_PEAK, MORNING_PEAK, bucketOf, buildSpeedModel, edgeTimeSec } from '../../../src/routing/travel-time';
import { gridNetwork } from '../../fixtures/grid';

// Requirements L-4 (TomTom 2025 calibration), X-1 (monsoon −30%), architecture AD-7 (15-minute buckets).

const CAL = { freeFlowRefKmh: 30, morningPeakKmh: 14.6, eveningPeakKmh: 13.2 };

function meanFactor(f: Float64Array, [from, to]: readonly [number, number]): number {
  let sum = 0;
  let n = 0;
  for (let b = from / BUCKET_SEC; b < to / BUCKET_SEC; b++) {
    sum += f[b]!;
    n++;
  }
  return sum / n;
}

describe('bucketOf', () => {
  it('maps seconds of day to 15-minute buckets', () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(899)).toBe(0);
    expect(bucketOf(900)).toBe(1);
    expect(bucketOf(9 * 3600)).toBe(36);
    expect(bucketOf(86_399)).toBe(95);
  });

  it('rejects seconds outside a day', () => {
    expect(() => bucketOf(-1)).toThrow(RangeError);
    expect(() => bucketOf(86_400)).toThrow(RangeError);
  });
});

describe('buildSpeedModel', () => {
  it('has one factor per bucket, each in (0, 1]', () => {
    const m = buildSpeedModel(CAL);
    expect(m.todFactor.length).toBe(BUCKETS_PER_DAY);
    for (const f of m.todFactor) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('is free-flowing from 23:00 to 05:00', () => {
    const m = buildSpeedModel(CAL);
    for (let b = 0; b < 20; b++) expect(m.todFactor[b]).toBe(1);
    for (let b = 92; b < 96; b++) expect(m.todFactor[b]).toBe(1);
  });

  it('reproduces the TomTom rush-hour averages over each rush window (±0.01)', () => {
    const m = buildSpeedModel(CAL);
    expect(meanFactor(m.todFactor, MORNING_PEAK)).toBeCloseTo(14.6 / 30, 2);
    expect(meanFactor(m.todFactor, EVENING_PEAK)).toBeCloseTo(13.2 / 30, 2);
  });

  it('changes smoothly (adjacent buckets differ by at most 0.15)', () => {
    const f = buildSpeedModel(CAL).todFactor;
    for (let b = 0; b < BUCKETS_PER_DAY; b++) expect(Math.abs(f[(b + 1) % BUCKETS_PER_DAY]! - f[b]!)).toBeLessThanOrEqual(0.15);
  });

  it('defaults to clear weather and unit class factors', () => {
    const m = buildSpeedModel(CAL);
    expect(m.weatherFactor).toBe(1);
    expect(Object.values(m.classFactor).every((v) => v === 1)).toBe(true);
    expect(buildSpeedModel(CAL, 0.7).weatherFactor).toBe(0.7);
  });
});

describe('edgeTimeSec', () => {
  const edge = 0;
  /** Built per test so a stubbed graph builder fails each test individually. */
  const road = (): RoadGraph => buildGraph(gridNetwork(2, 1, 100, { highway: 'tertiary' }));

  it('is length ÷ free speed at night', () => {
    const g = road();
    expect(edgeTimeSec(g, edge, bucketOf(3 * 3600), buildSpeedModel(CAL))).toBeCloseTo(100 / g.edgeFreeSpeedMps[edge]!, 9);
  });

  it('is slower in the morning rush', () => {
    const g = road();
    const m = buildSpeedModel(CAL);
    expect(edgeTimeSec(g, edge, bucketOf(9 * 3600), m)).toBeGreaterThan(edgeTimeSec(g, edge, bucketOf(3 * 3600), m));
  });

  it('is constant within a bucket', () => {
    const g = road();
    const m = buildSpeedModel(CAL);
    expect(edgeTimeSec(g, edge, bucketOf(9 * 3600), m)).toBe(edgeTimeSec(g, edge, bucketOf(9 * 3600 + 899), m));
  });

  it('takes 1/0.7 as long in a monsoon downpour', () => {
    const g = road();
    const b = bucketOf(12 * 3600);
    expect(edgeTimeSec(g, edge, b, buildSpeedModel(CAL, 0.7))).toBeCloseTo(edgeTimeSec(g, edge, b, buildSpeedModel(CAL)) / 0.7, 9);
  });

  it('is Infinity on a closed edge', () => {
    const g = road();
    expect(edgeTimeSec(g, edge, 0, buildSpeedModel(CAL), new Set([edge]))).toBe(Number.POSITIVE_INFINITY);
  });
});
