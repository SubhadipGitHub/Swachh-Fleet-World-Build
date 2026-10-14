import { describe, expect, it } from 'vitest';
import type { WardShape } from '../../../src/geo/snapshot';
import { DisplayIds, wardAt, wardCode } from '../../../src/sim/naming';

// Requirements D-7: synthetic display ids in the documented formats, coded by ward.

const square = (x0: number, y0: number, s: number): [number, number][] => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
  [x0, y0],
];
const WARDS: WardShape[] = [
  { key: 'South-72', name: 'HSR Layout', population2011: 18_787, rings: [square(0, 0, 100)] },
  { key: 'South-71', name: 'Agara', population2011: 18_836, rings: [square(200, 0, 100)] },
];

describe('wardAt', () => {
  it('finds the ward containing a point', () => {
    expect(wardAt(WARDS, 50, 50)?.key).toBe('South-72');
    expect(wardAt(WARDS, 250, 50)?.key).toBe('South-71');
  });

  it('falls back to the nearest ward for points in the buffer outside every ward', () => {
    expect(wardAt(WARDS, 290, 150)?.key).toBe('South-71');
    expect(wardAt([], 0, 0)).toBeNull();
  });
});

describe('DisplayIds', () => {
  it('numbers auto-tippers per ward code', () => {
    const ids = new DisplayIds();
    expect(ids.autoTipper(WARDS[0]!)).toBe('AT-HSR-001');
    expect(ids.autoTipper(WARDS[0]!)).toBe('AT-HSR-002');
    expect(ids.autoTipper(WARDS[1]!)).toBe('AT-AGR-001');
    expect(ids.autoTipper(null)).toBe('AT-BLR-001');
  });

  it('formats compactors, crews, bins, black spots and transfer points', () => {
    const ids = new DisplayIds();
    expect(ids.compactor()).toBe('CP-BLR-S-01');
    expect(ids.crew()).toBe('CR-BLR-S-01');
    expect(ids.bin(WARDS[0]!)).toBe('HS-101');
    expect(ids.blackSpot(WARDS[1]!)).toBe('GVP-AGR-001');
    expect(ids.transferPoint(4)).toBe('TP-05');
    expect(wardCode(null, 'short')).toBe('BL');
  });
});
