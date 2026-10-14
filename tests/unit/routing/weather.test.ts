import { describe, expect, it } from 'vitest';
import { BUCKETS_PER_DAY, applyWeather, buildSpeedModel } from '../../../src/routing/travel-time';

// Requirements X-1, architecture M2-4: weather changes speeds.

const BASE = buildSpeedModel({ freeFlowRefKmh: 30, morningPeakKmh: 14.6, eveningPeakKmh: 13.2 });

describe('applyWeather', () => {
  it('slows everything by 30% in a monsoon downpour', () => {
    const m = applyWeather(BASE, 'monsoon');
    expect(m.weatherFactor).toBeCloseTo(0.7, 12);
    expect([...m.todFactor]).toEqual([...BASE.todFactor]);
  });

  it('slows only 05:00–09:00 by 10% in winter haze', () => {
    const m = applyWeather(BASE, 'haze');
    expect(m.weatherFactor).toBe(BASE.weatherFactor);
    for (let b = 0; b < BUCKETS_PER_DAY; b++) {
      const expected = b >= 20 && b < 36 ? BASE.todFactor[b]! * 0.9 : BASE.todFactor[b]!;
      expect(m.todFactor[b]).toBeCloseTo(expected, 12);
    }
  });

  it('leaves speeds unchanged in clear weather and a heatwave', () => {
    for (const mode of ['clear', 'heatwave'] as const) {
      const m = applyWeather(BASE, mode);
      expect(m.weatherFactor).toBe(BASE.weatherFactor);
      expect([...m.todFactor]).toEqual([...BASE.todFactor]);
    }
  });

  it('does not change the base model', () => {
    const before = [...BASE.todFactor];
    applyWeather(BASE, 'haze');
    applyWeather(BASE, 'monsoon');
    expect([...BASE.todFactor]).toEqual(before);
    expect(BASE.weatherFactor).toBe(1);
  });
});
