import { describe, expect, it } from 'vitest';
import { rngFromSeed } from '../../../src/sim/rng';
import { readSensor, type SensorParams, type SensorState } from '../../../src/sim/sensors';

// Requirements L-1 step 2: readings every 15 minutes with realistic noise and occasional stuck or offline sensors.

const RELIABLE: SensorParams = { noiseSdPct: 3, faultChancePerReading: 0, recoverChancePerReading: 0 };
const OK: SensorState = { status: 'ok', lastReportedPct: null };

describe('readSensor', () => {
  it('reports true fill plus noise when working, rounded to 0.1', () => {
    const rng = rngFromSeed(1);
    const values: number[] = [];
    let state = OK;
    for (let i = 0; i < 20_000; i++) {
      const { reading, next } = readSensor(50, state, rng, RELIABLE);
      expect(reading.status).toBe('ok');
      expect(reading.fillPct).not.toBeNull();
      expect(Math.round(reading.fillPct! * 10) / 10).toBe(reading.fillPct);
      values.push(reading.fillPct!);
      state = next;
    }
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    expect(mean).toBeCloseTo(50, 0);
    expect(sd).toBeGreaterThan(2.5);
    expect(sd).toBeLessThan(3.5);
  });

  it('clamps readings to 0–100 (an ultrasonic sensor cannot read past full)', () => {
    const rng = rngFromSeed(2);
    for (let i = 0; i < 2_000; i++) {
      const hi = readSensor(130, OK, rng, RELIABLE).reading.fillPct!;
      const lo = readSensor(-5, OK, rng, RELIABLE).reading.fillPct!;
      expect(hi).toBeLessThanOrEqual(100);
      expect(lo).toBeGreaterThanOrEqual(0);
    }
  });

  it('remembers the last reported value', () => {
    const { reading, next } = readSensor(42, OK, rngFromSeed(3), { ...RELIABLE, noiseSdPct: 0 });
    expect(reading.fillPct).toBe(42);
    expect(next).toEqual({ status: 'ok', lastReportedPct: 42 });
  });

  it('a stuck sensor repeats its last value regardless of the true fill', () => {
    const stuck: SensorState = { status: 'stuck', lastReportedPct: 37.5 };
    const { reading } = readSensor(95, stuck, rngFromSeed(4), RELIABLE);
    expect(reading).toEqual({ fillPct: 37.5, status: 'stuck' });
  });

  it('an offline sensor reports nothing', () => {
    const { reading } = readSensor(95, { status: 'offline', lastReportedPct: 10 }, rngFromSeed(5), RELIABLE);
    expect(reading).toEqual({ fillPct: null, status: 'offline' });
  });

  it('fails at about the configured rate, split between stuck and offline', () => {
    const rng = rngFromSeed(6);
    const params: SensorParams = { noiseSdPct: 1, faultChancePerReading: 0.01, recoverChancePerReading: 0 };
    let stuck = 0;
    let offline = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const s = readSensor(50, { status: 'ok', lastReportedPct: 50 }, rng, params).next.status;
      if (s === 'stuck') stuck++;
      if (s === 'offline') offline++;
    }
    expect((stuck + offline) / n).toBeCloseTo(0.01, 2);
    expect(stuck / (stuck + offline)).toBeGreaterThan(0.4);
    expect(stuck / (stuck + offline)).toBeLessThan(0.6);
  });

  it('recovers at the configured rate', () => {
    const rng = rngFromSeed(7);
    const params: SensorParams = { noiseSdPct: 1, faultChancePerReading: 0, recoverChancePerReading: 1 };
    expect(readSensor(50, { status: 'offline', lastReportedPct: null }, rng, params).reading.status).toBe('ok');
  });

  it('is deterministic for the same generator state', () => {
    const a = readSensor(61, OK, rngFromSeed(8), { ...RELIABLE, faultChancePerReading: 0.3 });
    const b = readSensor(61, OK, rngFromSeed(8), { ...RELIABLE, faultChancePerReading: 0.3 });
    expect(a).toEqual(b);
  });
});
