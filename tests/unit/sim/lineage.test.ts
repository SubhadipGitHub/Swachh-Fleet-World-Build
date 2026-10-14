import { describe, expect, it } from 'vitest';
import { Lineage } from '../../../src/sim/lineage';

// Architecture M2-8: following waste from a bin or street to KCDC.

const BIN0 = { type: 'bin', id: 0 } as const;
const SEG5 = { type: 'segment', id: 5 } as const;

function scenario(): Lineage {
  const l = new Lineage();
  l.collect(BIN0, 10, 100, 1);
  l.collect(SEG5, 30, 200, 1);
  return l;
}

describe('Lineage', () => {
  it('records collections against the collecting vehicle, with increasing ids', () => {
    const l = scenario();
    const carried = l.carriedBy(1);
    expect(carried.map((b) => [b.id, b.origin, b.kg, b.collectedAt, b.collectedBy])).toEqual([
      [1, BIN0, 10, 100, 1],
      [2, SEG5, 30, 200, 1],
    ]);
    expect(carried.every((b) => b.transferredAt === null && b.processedAt === null)).toBe(true);
  });

  it('moves a vehicle’s batches to the back of the transfer point’s queue when it tips', () => {
    const l = scenario();
    l.tip(1, 0, 300);
    expect(l.carriedBy(1)).toEqual([]);
    expect(l.waitingAt(0).map((b) => [b.id, b.transferredAt, b.transferPointId])).toEqual([
      [1, 300, 0],
      [2, 300, 0],
    ]);
  });

  it('loads first-in first-out, splitting the last batch (the loaded part gets a new id)', () => {
    const l = scenario();
    l.tip(1, 0, 300);
    expect(l.load(0, 25, 400, 9)).toBe(25);
    expect(l.waitingAt(0).map((b) => [b.id, b.kg])).toEqual([[2, 15]]);
    const onTruck = l.carriedBy(9);
    expect(onTruck.map((b) => [b.origin, b.kg, b.loadedAt])).toEqual([
      [BIN0, 10, 400],
      [SEG5, 15, 400],
    ]);
    expect(onTruck[1]!.id).toBeGreaterThan(2);
    expect(onTruck[1]!.transferredAt).toBe(300);
    expect(l.load(0, 100, 500, 9)).toBe(15);
    expect(l.waitingAt(0)).toEqual([]);
    expect(l.load(0, 10, 600, 9)).toBe(0);
  });

  it('stamps everything a vehicle carries as processed when it unloads', () => {
    const l = scenario();
    l.tip(1, 0, 300);
    l.load(0, 100, 400, 9);
    l.unload(9, 'KCDC', 700);
    expect(l.carriedBy(9)).toEqual([]);
    const latest = l.latestFor(BIN0)!;
    expect([latest.processedAt, latest.site]).toEqual([700, 'KCDC']);
  });

  it('returns the latest collection from an origin, and of a split, the part furthest along', () => {
    const l = scenario();
    l.collect(BIN0, 4, 250, 1);
    expect(l.latestFor(BIN0)!.collectedAt).toBe(250);
    l.tip(1, 0, 300);
    l.load(0, 25, 400, 9);
    const seg = l.latestFor(SEG5)!;
    expect(seg.loadedAt).toBe(400);
    expect(l.latestFor({ type: 'bin', id: 99 })).toBeNull();
  });

  it('prunes old processed batches but keeps unfinished ones', () => {
    const l = scenario();
    l.tip(1, 0, 300);
    l.load(0, 10, 400, 9);
    l.unload(9, 'Landfill', 500);
    l.pruneBefore(1000);
    expect(l.latestFor(BIN0)).toBeNull();
    expect(l.latestFor(SEG5)).not.toBeNull();
  });
});
