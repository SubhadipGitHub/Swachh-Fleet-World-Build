import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCalibration } from '../../src/config/calibration';
import { deriveClusterScale } from '../../src/config/derive';
import { decodeSnapshot, type SnapshotFiles } from '../../src/geo/snapshot';
import { DAY_SEC } from '../../src/sim/clock';
import { buildMapData } from '../../src/sim/map-data';
import { createWorld, stepWorld } from '../../src/sim/world';
import { defaultWorldConfig } from '../../src/sim/world-config';

// Architecture AD-14: one simulated day of the real cluster, live world plus shadow twin, in ≤ 1.5 s headless.

function loadLatestSnapshot(): SnapshotFiles {
  const root = resolve(import.meta.dirname, '../../data/snapshot');
  const dir = join(root, readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop()!);
  const bin = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)));
  const text = (name: string): string => readFileSync(join(dir, name), 'utf8');
  return {
    'manifest.json': text('manifest.json'),
    'roads.bin': bin('roads.bin'),
    'buildings.bin': bin('buildings.bin'),
    'areas.bin': bin('areas.bin'),
    'wards.json': text('wards.json'),
    'pois.json': text('pois.json'),
  };
}

describe('performance gates', () => {
  it('simulates one full day of the live world and the shadow twin in ≤ 1.5 s', () => {
    const cal = getCalibration();
    const scale = deriveClusterScale(cal);
    const map = buildMapData(decodeSnapshot(loadLatestSnapshot()), scale, { smartBins: cal.smartBins.value, transferPoints: cal.transferPoints.value, seed: 1 });
    const config = defaultWorldConfig(cal, scale, 'clear');
    const spec = {
      v: 1 as const,
      seed: 1,
      startDate: '2026-10-14' as const,
      days: 1,
      weather: 'clear' as const,
      policy: 'static' as const,
      levers: { tipperAbsenceRate: cal.tipperAbsenceRate.value, breakdownChancePerShift: 0.01, skipChance: 0.02 },
    };
    const live = createWorld(map, config, spec);
    const twin = createWorld(map, config, spec);

    const start = performance.now();
    for (let t = 0; t < DAY_SEC; t++) {
      stepWorld(live);
      stepWorld(twin);
    }
    const elapsedMs = performance.now() - start;
    console.info(`sim day (live + twin): ${elapsedMs.toFixed(0)} ms`);
    expect(elapsedMs).toBeLessThanOrEqual(1500);
  });
});
