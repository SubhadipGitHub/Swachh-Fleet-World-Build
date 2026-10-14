import { describe, expect, it } from 'vitest';
import { getCalibration } from '../../src/config/calibration';
import { deriveClusterScale } from '../../src/config/derive';
import { decodeSnapshot } from '../../src/geo/snapshot';
import { DAY_SEC } from '../../src/sim/clock';
import { buildMapData } from '../../src/sim/map-data';
import { createWorld, massBalance, runUntil, type MassBalance } from '../../src/sim/world';
import { baselineLevers, defaultWorldConfig } from '../../src/sim/world-config';
import { loadLatestSnapshot } from './snapshot';

// Requirement M3-3 and architecture M3-D3: the calibrated Static baseline collects 50–60% of the waste generated
// (B.PAC 2023: "< 60% collected"), measured on days 3–7 in clear weather. 3 seeds here (the calibration script uses 5).

const collectedOf = (b: MassBalance): number => b.generatedKg - b.uncollectedKg - b.leakedKg;

describe('calibrated baseline', () => {
  it('collects 50–60% of the generated waste over days 3–7', () => {
    const cal = getCalibration();
    const scale = deriveClusterScale(cal);
    const snapshot = decodeSnapshot(loadLatestSnapshot());
    const shares: number[] = [];
    for (const seed of [1, 2, 3]) {
      const map = buildMapData(snapshot, scale, { smartBins: cal.smartBins.value, transferPoints: cal.transferPoints.value, seed });
      const world = createWorld(map, defaultWorldConfig(cal, scale, 'clear'), {
        v: 1,
        seed,
        startDate: '2026-10-14',
        days: 7,
        weather: 'clear',
        policy: 'static',
        levers: baselineLevers(cal),
      });
      runUntil(world, 2 * DAY_SEC);
      const from = massBalance(world);
      runUntil(world, 7 * DAY_SEC);
      const to = massBalance(world);
      shares.push((collectedOf(to) - collectedOf(from)) / (to.generatedKg - from.generatedKg));
    }
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    console.info(`baseline collected share, days 3–7: ${shares.map((s) => (100 * s).toFixed(1)).join(', ')} → mean ${(100 * mean).toFixed(1)}%`);
    expect(mean).toBeGreaterThanOrEqual(0.5);
    expect(mean).toBeLessThanOrEqual(0.6);
  });
});
