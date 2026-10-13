import { describe, expect, it } from 'vitest';
import { getCalibration } from '../../../src/config/calibration';
import { deriveClusterScale } from '../../../src/config/derive';
import { defaultWorldConfig } from '../../../src/sim/world-config';

// Requirements W-5, L-1, X-1: the live world is configured from the calibration, not from typed-in numbers.

describe('defaultWorldConfig', () => {
  const build = (weather: 'clear' | 'monsoon' = 'clear') => {
    const cal = getCalibration();
    const scale = deriveClusterScale(cal);
    return { cal, scale, config: defaultWorldConfig(cal, scale, weather) };
  };

  it('sizes the fleet from the derived scale', () => {
    const { scale, config } = build();
    expect(config.fleet.autoTippers).toBe(scale.autoTippers.value);
    expect(config.fleet.compactors).toBe(scale.compactors.value);
    expect(config.fleet.crews).toBe(2);
  });

  it('uses the shift windows from L-1', () => {
    const { config } = build();
    expect(config.fleet.tipperShift).toEqual([6 * 3600, 14 * 3600]);
    expect(config.fleet.compactorShift).toEqual([7 * 3600, 19 * 3600]);
  });

  it('derives per-household waste and the KCDC cap in kg', () => {
    const { cal, scale, config } = build();
    expect(config.householdKgPerDay).toBeCloseTo(scale.perCapitaKgPerDay.value * cal.personsPerHousehold.value, 9);
    expect(config.kcdcIntakeCapKg).toBe(cal.kcdcIntakeCapTpd.value * 1000);
  });

  it('slows traffic by 30% in a monsoon downpour', () => {
    expect(build('clear').config.speed.weatherFactor).toBe(1);
    expect(build('monsoon').config.speed.weatherFactor).toBe(0.7);
  });

  it('configures realistic sensors', () => {
    const { sensor } = build().config;
    expect(sensor.noiseSdPct).toBe(3);
    expect(sensor.faultChancePerReading).toBeGreaterThan(0);
    expect(sensor.faultChancePerReading).toBeLessThanOrEqual(0.01);
  });
});
