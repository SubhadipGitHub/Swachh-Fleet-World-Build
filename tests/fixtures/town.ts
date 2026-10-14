import type { ScenarioSpec } from '../../src/config/scenario';
import { buildGraph, nodeIndex } from '../../src/routing/graph';
import { segmentsFromGraph } from '../../src/routing/beats';
import { buildSpeedModel } from '../../src/routing/travel-time';
import type { MapData } from '../../src/sim/map-data';
import type { WorldConfig } from '../../src/sim/world';
import { gridNetwork, gridNodeId } from './grid';

const COLS = 6;
const ROWS = 6;

/**
 * A small hand-built town for integration tests: a 6 × 6 grid of 120 m residential blocks (60 street segments,
 * 60 households each = 3,600 households), a depot, 2 transfer points, KCDC, an exit to the off-map landfill,
 * 4 market bins and 2 black spots. Built lazily so a stubbed module fails the test, not the import.
 */
export function buildTown(): MapData {
  const graph = buildGraph(gridNetwork(COLS, ROWS, 120));
  const node = (c: number, r: number): number => nodeIndex(graph, gridNodeId(COLS, c, r));
  const segments = segmentsFromGraph(graph).map((s) => ({ ...s, households: 60 }));
  return {
    graph,
    segments,
    facilities: {
      depotNode: node(0, 0),
      transferPoints: [
        { id: 0, node: node(3, 0) },
        { id: 1, node: node(0, 5) },
      ],
      kcdcNode: node(5, 5),
      landfill: { exitNode: node(5, 0), offMapTravelSec: 2400 },
      dwccNode: node(2, 0),
    },
    bins: [0, 1, 2, 3].map((id) => ({
      id,
      node: node(1 + id, 2 + (id % 2)),
      kind: 'market' as const,
      capacityKg: 240,
      dailyKg: 120,
      profile: 'market' as const,
    })),
    blackSpots: [
      { id: 0, node: node(4, 4), segmentIds: [segments[40]!.id] },
      { id: 1, node: node(1, 4), segmentIds: [segments[12]!.id] },
    ],
    floodProneSpots: [],
  };
}

/**
 * The town with one flood-prone spot at grid node (2, 2): every edge touching that node closes in a monsoon.
 * Used by the M2 weather tests.
 */
export function buildFloodTown(): MapData {
  const town = buildTown();
  const g = town.graph;
  const spotNode = nodeIndex(g, gridNodeId(COLS, 2, 2));
  const edges: number[] = [];
  for (let e = 0; e < g.edgeCount; e++) if (g.edgeFrom[e] === spotNode || g.edgeTo[e] === spotNode) edges.push(e);
  return { ...town, floodProneSpots: [{ id: 0, node: spotNode, edges }] };
}

export function townConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    fleet: {
      autoTippers: 4,
      compactors: 2,
      crews: 1,
      tipperPayloadKg: 1000,
      compactorPayloadKg: 6000,
      tipperShift: [6 * 3600, 14 * 3600],
      compactorShift: [7 * 3600, 19 * 3600],
    },
    sensor: { noiseSdPct: 3, faultChancePerReading: 0.0005, recoverChancePerReading: 0.01 },
    speed: buildSpeedModel({ freeFlowRefKmh: 30, morningPeakKmh: 14.6, eveningPeakKmh: 13.2 }),
    householdKgPerDay: 1.53,
    kcdcIntakeCapKg: 1_000_000,
    blackSpotBaseChancePerHour: 0.002,
    dieselPriceInrPerL: 89,
    ...overrides,
  };
}

export function townSpec(overrides: Partial<ScenarioSpec> = {}): ScenarioSpec {
  return {
    v: 1,
    seed: 20261014,
    startDate: '2026-10-14',
    days: 1,
    weather: 'clear',
    policy: 'static',
    levers: { tipperAbsenceRate: 0, breakdownChancePerShift: 0, skipChance: 0 },
    ...overrides,
  };
}
