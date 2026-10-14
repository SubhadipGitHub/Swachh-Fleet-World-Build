import { describe, expect, it } from 'vitest';
import { keyedChance, keyedInt, keyedLogNormal, keyedNormal, keyedUnit } from '../../../src/sim/conditions';

// Architecture M3-D1: conditions are keyed draws, so the live world and the twin face the same ones whatever order
// they draw in.

const SEED = 20_261_014;

describe('keyed draws', () => {
  it('give the same value for the same keys, whatever was drawn before', () => {
    const a = keyedUnit(SEED, 'absence', 3, 1);
    for (let i = 0; i < 50; i++) keyedUnit(SEED, 'absence', i, 7);
    keyedUnit(SEED, 'breakdown', 3, 1);
    expect(keyedUnit(SEED, 'absence', 3, 1)).toBe(a);
  });

  it('stay in [0, 1)', () => {
    for (let k = 0; k < 2000; k++) {
      const u = keyedUnit(SEED, 'skip', k, 4);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('differ between keys, streams and seeds', () => {
    const base = keyedUnit(SEED, 'absence', 3, 1);
    expect(keyedUnit(SEED, 'absence', 1, 3)).not.toBe(base);
    expect(keyedUnit(SEED, 'absence', 3, 2)).not.toBe(base);
    expect(keyedUnit(SEED, 'breakdown', 3, 1)).not.toBe(base);
    expect(keyedUnit(SEED + 1, 'absence', 3, 1)).not.toBe(base);
  });

  it('look independent: neighbouring keys are not correlated', () => {
    const n = 5000;
    const xs = Array.from({ length: n }, (_, k) => keyedUnit(SEED, 'sensor', k, 0));
    const ys = Array.from({ length: n }, (_, k) => keyedUnit(SEED, 'sensor', k + 1, 0));
    const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    const mx = mean(xs);
    const my = mean(ys);
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < n; i++) {
      cov += (xs[i]! - mx) * (ys[i]! - my);
      vx += (xs[i]! - mx) ** 2;
      vy += (ys[i]! - my) ** 2;
    }
    expect(Math.abs(cov / Math.sqrt(vx * vy))).toBeLessThan(0.05);
    expect(mx).toBeGreaterThan(0.48);
    expect(mx).toBeLessThan(0.52);
  });

  it('hit the requested rate for chances, with p = 0 never and p = 1 always', () => {
    let hits = 0;
    const n = 20_000;
    for (let k = 0; k < n; k++) if (keyedChance(SEED, 'absence', 0.05, k, 9)) hits++;
    expect(hits / n).toBeGreaterThan(0.044);
    expect(hits / n).toBeLessThan(0.056);
    for (let k = 0; k < 200; k++) {
      expect(keyedChance(SEED, 'skip', 0, k)).toBe(false);
      expect(keyedChance(SEED, 'skip', 1, k)).toBe(true);
    }
  });

  it('draw integers inclusive of both ends', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 2000; k++) {
      const v = keyedInt(SEED, 'repair', 3, 6, k);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('draw standard normals and mean-1 lognormals', () => {
    const n = 20_000;
    const zs = Array.from({ length: n }, (_, k) => keyedNormal(SEED, 'generation', k));
    const mz = zs.reduce((a, b) => a + b, 0) / n;
    const sz = Math.sqrt(zs.reduce((a, z) => a + (z - mz) ** 2, 0) / n);
    expect(Math.abs(mz)).toBeLessThan(0.03);
    expect(sz).toBeGreaterThan(0.97);
    expect(sz).toBeLessThan(1.03);
    const ms = Array.from({ length: n }, (_, k) => keyedLogNormal(SEED, 'generation', 0.2, k, 1));
    const mean = ms.reduce((a, b) => a + b, 0) / n;
    expect(mean).toBeGreaterThan(0.99);
    expect(mean).toBeLessThan(1.01);
    const logs = ms.map(Math.log);
    const ml = logs.reduce((a, b) => a + b, 0) / n;
    const sl = Math.sqrt(logs.reduce((a, l) => a + (l - ml) ** 2, 0) / n);
    expect(sl).toBeGreaterThan(0.19);
    expect(sl).toBeLessThan(0.21);
    for (const m of ms) expect(m).toBeGreaterThan(0);
    expect(keyedLogNormal(SEED, 'generation', 0, 5, 5)).toBe(1);
  });
});
