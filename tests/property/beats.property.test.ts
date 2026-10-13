import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGraph, type RoadGraph } from '../../src/routing/graph';
import { orderBeat, partitionBeats, segmentsFromGraph, type StreetSegment } from '../../src/routing/beats';
import { gridNetwork } from '../fixtures/grid';

// Architecture AD-7: auto-tipper beats are contiguous, cover every segment exactly once and are balanced; each beat's
// walk covers its segments with connected edges.

interface Case {
  readonly g: RoadGraph;
  readonly segments: StreetSegment[];
  readonly k: number;
  readonly seed: number;
}

/**
 * Grids of 6–10 × 6–10 blocks with 10–20 households per segment, and k small enough that each beat has ≥ 40
 * segments. That meets the balance guarantee's precondition: no segment exceeds 5% of the per-beat target.
 */
const gridCase: fc.Arbitrary<Case> = fc
  .record({
    cols: fc.integer({ min: 6, max: 10 }),
    rows: fc.integer({ min: 6, max: 10 }),
    seed: fc.nat(),
    households: fc.array(fc.integer({ min: 10, max: 20 }), { minLength: 200, maxLength: 200 }),
    kFrac: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map(({ cols, rows, seed, households, kFrac }) => {
    const g = buildGraph(gridNetwork(cols, rows, 80));
    const segments = segmentsFromGraph(g).map((s, i) => ({ ...s, households: households[i % households.length]! }));
    const kMax = Math.max(1, Math.floor(segments.length / 40));
    return { g, segments, k: 1 + Math.floor(kFrac * (kMax - 1)), seed };
  });

function nodesOf(g: RoadGraph, s: StreetSegment): number[] {
  return s.edges.flatMap((e) => [g.edgeFrom[e]!, g.edgeTo[e]!]);
}

function isConnected(g: RoadGraph, segs: readonly StreetSegment[]): boolean {
  if (segs.length === 0) return false;
  const byNode = new Map<number, number[]>();
  segs.forEach((s, i) => {
    for (const n of nodesOf(g, s)) byNode.set(n, [...(byNode.get(n) ?? []), i]);
  });
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length > 0) {
    const i = stack.pop()!;
    for (const n of nodesOf(g, segs[i]!)) {
      for (const j of byNode.get(n) ?? []) {
        if (!seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
  }
  return seen.size === segs.length;
}

describe('segmentsFromGraph', () => {
  it('puts every directed edge in exactly one segment, pairing twins', () => {
    const g = buildGraph(gridNetwork(5, 4, 60, { oneway: (i) => (i % 4 === 0 ? 'yes' : 'no') }));
    const segs = segmentsFromGraph(g);
    const seen = new Map<number, number>();
    for (const s of segs) for (const e of s.edges) seen.set(e, (seen.get(e) ?? 0) + 1);
    expect(seen.size).toBe(g.edgeCount);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
    for (const s of segs) {
      if (s.edges.length === 2) expect(g.edgeTwin[s.edges[0]!]).toBe(s.edges[1]);
      else expect(g.edgeTwin[s.edges[0]!]).toBe(-1);
      expect(s.households).toBe(0);
      expect(s.lengthM).toBeCloseTo(g.edgeLengthM[s.edges[0]!]!, 9);
    }
    expect(segs.map((s) => s.id)).toEqual(segs.map((_, i) => i));
  });
});

describe('partitionBeats', () => {
  it('assigns every segment to exactly one of k beats', () => {
    fc.assert(
      fc.property(gridCase, ({ g, segments, k, seed }) => {
        const beats = partitionBeats(g, segments, k, seed);
        expect(beats).toHaveLength(k);
        const all = beats.flatMap((b) => b.segmentIds).sort((a, b) => a - b);
        expect(all).toEqual(segments.map((s) => s.id));
      }),
      { numRuns: 40 },
    );
  });

  it('makes every beat contiguous', () => {
    fc.assert(
      fc.property(gridCase, ({ g, segments, k, seed }) => {
        for (const b of partitionBeats(g, segments, k, seed)) {
          expect(isConnected(g, b.segmentIds.map((id) => segments[id]!))).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('balances households within ±15% of the mean', () => {
    fc.assert(
      fc.property(gridCase, ({ g, segments, k, seed }) => {
        const total = segments.reduce((s, x) => s + x.households, 0);
        const target = total / k;
        for (const b of partitionBeats(g, segments, k, seed)) {
          expect(b.households).toBe(b.segmentIds.reduce((s, id) => s + segments[id]!.households, 0));
          expect(Math.abs(b.households - target) / target).toBeLessThanOrEqual(0.15);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('is deterministic for a seed', () => {
    fc.assert(
      fc.property(gridCase, ({ g, segments, k, seed }) => {
        expect(partitionBeats(g, segments, k, seed)).toEqual(partitionBeats(g, segments, k, seed));
      }),
      { numRuns: 20 },
    );
  });

  it('rejects k < 1 and k above the segment count', () => {
    const g = buildGraph(gridNetwork(3, 3, 50));
    const segs = segmentsFromGraph(g);
    expect(() => partitionBeats(g, segs, 0, 1)).toThrow(RangeError);
    expect(() => partitionBeats(g, segs, segs.length + 1, 1)).toThrow(RangeError);
  });
});

describe('orderBeat', () => {
  it('produces a connected walk from the start node that serves each segment once, in order', () => {
    fc.assert(
      fc.property(gridCase, ({ g, segments, k, seed }) => {
        const beats = partitionBeats(g, segments, k, seed);
        for (const beat of beats) {
          const start = segments[beat.segmentIds[0]!]!.edges.map((e) => g.edgeFrom[e]!)[0]!;
          const walk = orderBeat(g, segments, beat, start);
          expect([...walk.order].sort((a, b) => a - b)).toEqual([...beat.segmentIds].sort((a, b) => a - b));
          expect(walk.serviceEdgeIndex).toHaveLength(walk.order.length);
          expect(g.edgeFrom[walk.edges[0]!]).toBe(start);
          for (let i = 1; i < walk.edges.length; i++) expect(g.edgeFrom[walk.edges[i]!]).toBe(g.edgeTo[walk.edges[i - 1]!]);
          walk.order.forEach((segId, i) => {
            const idx = walk.serviceEdgeIndex[i]!;
            if (i > 0) expect(idx).toBeGreaterThan(walk.serviceEdgeIndex[i - 1]!);
            expect(segments[segId]!.edges).toContain(walk.edges[idx]);
          });
          expect(walk.lengthM).toBeCloseTo(walk.edges.reduce((s, e) => s + g.edgeLengthM[e]!, 0), 6);
        }
      }),
      { numRuns: 25 },
    );
  });

  it('keeps the walk under 2.5 × the beat street length on grids (quality guard)', () => {
    fc.assert(
      fc.property(gridCase, ({ g, segments, k, seed }) => {
        for (const beat of partitionBeats(g, segments, k, seed)) {
          const start = g.edgeFrom[segments[beat.segmentIds[0]!]!.edges[0]!]!;
          const walk = orderBeat(g, segments, beat, start);
          const streets = beat.segmentIds.reduce((s, id) => s + segments[id]!.lengthM, 0);
          expect(walk.lengthM).toBeLessThanOrEqual(2.5 * streets);
        }
      }),
      { numRuns: 25 },
    );
  });
});
