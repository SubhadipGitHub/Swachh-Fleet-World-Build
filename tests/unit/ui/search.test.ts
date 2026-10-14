import { describe, expect, it } from 'vitest';
import { buildSearchIndex, search, type SearchEntry } from '../../../src/ui/search';

// Requirements D-2 and architecture M2-11: search over vehicles, bins, black spots, streets and wards.

const ENTRIES: SearchEntry[] = [
  { kind: 'vehicle', label: 'AT-HSR-010', keywords: ['auto-tipper'], ref: 0 },
  { kind: 'vehicle', label: 'AT-HSR-001', keywords: ['auto-tipper'], ref: 1 },
  { kind: 'vehicle', label: 'AT-KME-001', keywords: ['auto-tipper'], ref: 2 },
  { kind: 'ward', label: 'South-72 HSR Layout', keywords: ['72'], ref: 3 },
  { kind: 'street', label: '27th Main Road', ref: 4 },
  { kind: 'bin', label: 'HS-101', keywords: ['market'], ref: 5 },
  { kind: 'blackSpot', label: 'GVP-HSR-002', ref: 6 },
];
const labels = (q: string, limit?: number): string[] => search(buildSearchIndex(ENTRIES), q, limit).map((e) => e.label);

describe('search', () => {
  it('ranks an exact id first', () => {
    expect(labels('at-hsr-001')[0]).toBe('AT-HSR-001');
  });

  it('matches word and keyword prefixes, ignoring case, in index order', () => {
    expect(labels('hsr')).toEqual(['AT-HSR-010', 'AT-HSR-001', 'South-72 HSR Layout', 'GVP-HSR-002']);
    expect(labels('72')).toEqual(['South-72 HSR Layout']);
    expect(labels('market')).toEqual(['HS-101']);
    expect(labels('main')).toEqual(['27th Main Road']);
  });

  it('puts prefix matches before substring matches', () => {
    expect(labels('ain')).toEqual(['27th Main Road']);
    expect(labels('s-1')).toEqual(['HS-101']);
    expect(labels('h')).toEqual(['AT-HSR-010', 'AT-HSR-001', 'South-72 HSR Layout', 'HS-101', 'GVP-HSR-002', '27th Main Road']);
  });

  it('limits results and returns nothing for a blank query', () => {
    expect(labels('a', 2)).toHaveLength(2);
    expect(labels('')).toEqual([]);
    expect(labels('   ')).toEqual([]);
    expect(labels('zzz')).toEqual([]);
  });
});
