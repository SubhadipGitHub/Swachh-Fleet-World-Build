import { describe, expect, it } from 'vitest';
import { filterRows, sortRows } from '../../../src/ui/table';

// Requirements D-6: sortable, filterable live tables.

const ROWS = [
  { id: 'AT-HSR-10', km: 4.5, state: 'On beat', eta: null },
  { id: 'AT-HSR-2', km: 12, state: 'Collecting', eta: 30_000 },
  { id: 'CP-BLR-S-01', km: 0, state: 'Off shift', eta: null },
  { id: 'AT-AGR-7', km: 4.5, state: 'On beat', eta: 25_000 },
];

describe('sortRows', () => {
  it('sorts numbers both ways, keeping ties in their original order', () => {
    expect(sortRows(ROWS, 'km', 'asc').map((r) => r.id)).toEqual(['CP-BLR-S-01', 'AT-HSR-10', 'AT-AGR-7', 'AT-HSR-2']);
    expect(sortRows(ROWS, 'km', 'desc').map((r) => r.id)).toEqual(['AT-HSR-2', 'AT-HSR-10', 'AT-AGR-7', 'CP-BLR-S-01']);
  });

  it('sorts strings numerically aware', () => {
    expect(sortRows(ROWS, 'id', 'asc').map((r) => r.id)).toEqual(['AT-AGR-7', 'AT-HSR-2', 'AT-HSR-10', 'CP-BLR-S-01']);
  });

  it('always puts nulls last', () => {
    expect(sortRows(ROWS, 'eta', 'asc').map((r) => r.eta)).toEqual([25_000, 30_000, null, null]);
    expect(sortRows(ROWS, 'eta', 'desc').map((r) => r.eta)).toEqual([30_000, 25_000, null, null]);
  });

  it('does not mutate its input', () => {
    const before = ROWS.map((r) => r.id);
    sortRows(ROWS, 'km', 'desc');
    expect(ROWS.map((r) => r.id)).toEqual(before);
  });
});

describe('filterRows', () => {
  it('keeps rows where every term appears in some cell, ignoring case', () => {
    expect(filterRows(ROWS, 'on beat').map((r) => r.id)).toEqual(['AT-HSR-10', 'AT-AGR-7']);
    expect(filterRows(ROWS, 'hsr beat').map((r) => r.id)).toEqual(['AT-HSR-10']);
    expect(filterRows(ROWS, '12').map((r) => r.id)).toEqual(['AT-HSR-2']);
  });

  it('keeps everything for blank text', () => {
    expect(filterRows(ROWS, '  ')).toHaveLength(4);
  });
});
