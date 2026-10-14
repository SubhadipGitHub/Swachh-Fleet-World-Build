// Calibrates the Static baseline (architecture M3-D3) to the B.PAC 2023 figure, "< 60% collected": finds the
// non-compliance intensity k (skip chance k, early-return chance k ÷ 2) for which the Static baseline collects 55% of
// the waste generated on days 3–7, mean over 5 seeds, in clear weather, and the smallest leakage share for which the
// backlog levels off (day-7 backlog at most 1.05 × day-5). Run by hand; it prints the values for
// src/config/calibration.ts. Usage:
//   npx tsx scripts/calibrate.ts                 search
//   npx tsx scripts/calibrate.ts --k 0.3 --leak 0.5   evaluate one setting
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getCalibration } from '../src/config/calibration';
import { deriveClusterScale } from '../src/config/derive';
import { decodeSnapshot, type SnapshotFiles } from '../src/geo/snapshot';
import { DAY_SEC } from '../src/sim/clock';
import { buildMapData, type MapData } from '../src/sim/map-data';
import { createWorld, massBalance, runUntil, type MassBalance } from '../src/sim/world';
import { defaultWorldConfig } from '../src/sim/world-config';

const SEEDS = [1, 2, 3, 4, 5];
const TARGET = 0.55;
const PLATEAU = 1.05;

function snapshotFiles(): SnapshotFiles {
  const root = resolve(import.meta.dirname, '../data/snapshot');
  const dir = join(root, readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop()!);
  const bin = (n: string): Uint8Array => new Uint8Array(readFileSync(join(dir, n)));
  const text = (n: string): string => readFileSync(join(dir, n), 'utf8');
  return { 'manifest.json': text('manifest.json'), 'roads.bin': bin('roads.bin'), 'buildings.bin': bin('buildings.bin'), 'areas.bin': bin('areas.bin'), 'wards.json': text('wards.json'), 'pois.json': text('pois.json') };
}

const cal = getCalibration();
const scale = deriveClusterScale(cal);
const snapshot = decodeSnapshot(snapshotFiles());
const maps = new Map<number, MapData>();
const mapFor = (seed: number): MapData => {
  let m = maps.get(seed);
  if (!m) {
    m = buildMapData(snapshot, scale, { smartBins: cal.smartBins.value, transferPoints: cal.transferPoints.value, seed });
    maps.set(seed, m);
  }
  return m;
};

const collectedOf = (b: MassBalance): number => b.generatedKg - b.uncollectedKg - b.leakedKg;

/** Mean collected share on days 3–7, and the mean day-7 ÷ day-5 backlog ratio. */
function evaluate(k: number, leak: number): { share: number; plateau: number } {
  let share = 0;
  let plateau = 0;
  for (const seed of SEEDS) {
    const world = createWorld(mapFor(seed), { ...defaultWorldConfig(cal, scale, 'clear'), leakageSharePerDay: leak }, {
      v: 1,
      seed,
      startDate: '2026-10-14',
      days: 7,
      weather: 'clear',
      policy: 'static',
      levers: { tipperAbsenceRate: cal.tipperAbsenceRate.value, breakdownChancePerShift: cal.breakdownChancePerShift.value, skipChance: k, earlyReturnChance: k / 2 },
    });
    runUntil(world, 2 * DAY_SEC);
    const d2 = massBalance(world);
    runUntil(world, 5 * DAY_SEC);
    const d5 = massBalance(world);
    runUntil(world, 7 * DAY_SEC);
    const d7 = massBalance(world);
    share += (collectedOf(d7) - collectedOf(d2)) / (d7.generatedKg - d2.generatedKg);
    plateau += d7.uncollectedKg / Math.max(1, d5.uncollectedKg);
  }
  return { share: share / SEEDS.length, plateau: plateau / SEEDS.length };
}

function log(k: number, leak: number, r: { share: number; plateau: number }): void {
  console.info(`k ${k.toFixed(4)}  leak ${leak.toFixed(2)}  collected ${(100 * r.share).toFixed(2)}%  backlog day7/day5 ${r.plateau.toFixed(3)}`);
}

/** Bisection on k for the target share at a given leakage. */
function solveK(leak: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const r = evaluate(mid, leak);
    log(mid, leak, r);
    if (r.share > TARGET) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The smallest leakage share (in steps of 0.05) for which the backlog levels off, at a given k. */
function solveLeak(k: number): number {
  for (let leak = 0.05; leak <= 1 + 1e-9; leak += 0.05) {
    const r = evaluate(k, leak);
    log(k, leak, r);
    if (r.plateau <= PLATEAU) return Math.round(leak * 100) / 100;
  }
  return 1;
}

const args = process.argv.slice(2);
const arg = (name: string): number | null => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : null;
};
const kArg = arg('--k');
const leakArg = arg('--leak');
if (kArg !== null) {
  const leak = leakArg ?? cal.leakageSharePerDay.value;
  const t0 = performance.now();
  log(kArg, leak, evaluate(kArg, leak));
  console.info(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
} else {
  // Two rounds: k for the target at a first leakage guess, the plateau leakage at that k, then k again.
  let leak = cal.leakageSharePerDay.value;
  let k = solveK(leak);
  leak = solveLeak(k);
  k = solveK(leak);
  const final = evaluate(k, leak);
  log(k, leak, final);
  console.info(`\nFor src/config/calibration.ts: NON_COMPLIANCE_K = ${k.toFixed(3)}, LEAKAGE_SHARE = ${leak.toFixed(2)}`);
}
