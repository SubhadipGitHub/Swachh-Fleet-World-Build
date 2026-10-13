import { notImplemented } from '../shared/not-implemented';
import type { ScenarioSpec } from '../config/scenario';
import type { SpeedModel } from '../routing/travel-time';
import type { SimTime } from './clock';
import type { SimEvent } from './events';
import type { MapData } from './map-data';
import type { SensorParams } from './sensors';

export interface FleetConfig {
  readonly autoTippers: number;
  readonly compactors: number;
  readonly crews: number;
  readonly tipperPayloadKg: number;
  readonly compactorPayloadKg: number;
  /** Auto-tipper shift window, seconds of day (IST). */
  readonly tipperShift: readonly [start: number, end: number];
  /** Compactor shift window, seconds of day (IST). */
  readonly compactorShift: readonly [start: number, end: number];
}

export interface WorldConfig {
  readonly fleet: FleetConfig;
  readonly sensor: SensorParams;
  readonly speed: SpeedModel;
  /** Waste per household per day (kg), before weather and festival multipliers. */
  readonly householdKgPerDay: number;
  readonly kcdcIntakeCapKg: number;
  /** Chance per hourly check that a dormant black spot activates with no pressure on it. */
  readonly blackSpotBaseChancePerHour: number;
}

/** Opaque world state. */
export interface World {
  readonly spec: ScenarioSpec;
}

export type VehicleKind = 'auto-tipper' | 'compactor' | 'crew';

export interface VehicleSummary {
  readonly id: number;
  readonly kind: VehicleKind;
  /** The state machine's current state kind, e.g. "OffShift". */
  readonly state: string;
}

/** Where every kilogram generated so far is (requirements L-1). The parts sum to generatedKg. */
export interface MassBalance {
  readonly generatedKg: number;
  /** Still on streets and in bins, including active black spots. */
  readonly uncollectedKg: number;
  readonly onVehiclesKg: number;
  readonly atTransferPointsKg: number;
  readonly deliveredKcdcKg: number;
  readonly deliveredLandfillKg: number;
}

export function createWorld(map: MapData, config: WorldConfig, spec: ScenarioSpec): World {
  return notImplemented('createWorld', map, config, spec);
}

/**
 * Advances exactly one second (fixed dt, AD-5): a step from t to t + 1 processes instant t + 1, and the events it
 * emits carry t + 1. Periodic work (sensor readings every 900 s, hourly black-spot checks) happens at multiples of
 * its period, so the first sensor reading is at t = 900.
 */
export function stepWorld(world: World): void {
  notImplemented('stepWorld', world);
}

/** Steps until worldTime(world) === t. Throws RangeError if t is in the past. */
export function runUntil(world: World, t: SimTime): void {
  notImplemented('runUntil', world, t);
}

export function worldTime(world: World): SimTime {
  return notImplemented('worldTime', world);
}

/** Events since the previous drain, in time order. */
export function drainEvents(world: World): SimEvent[] {
  return notImplemented('drainEvents', world);
}

export function vehicles(world: World): VehicleSummary[] {
  return notImplemented('vehicles', world);
}

export function massBalance(world: World): MassBalance {
  return notImplemented('massBalance', world);
}
