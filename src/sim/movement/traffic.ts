import { notImplemented } from '../../shared/not-implemented';
import type { RoadGraph } from '../../routing/graph';
import type { SimTime } from '../clock';

/** Fleet movement on lane queues (AD-6). */
export interface TrafficParams {
  /** Minimum clear gap between a vehicle's front and the leader's rear (m). */
  readonly minGapM: number;
  /** Seconds a vehicle waits behind a stopped service vehicle on a two-way street before passing it. */
  readonly passDelaySec: number;
  readonly maxAccelMps2: number;
  readonly maxDecelMps2: number;
}

export const DEFAULT_TRAFFIC_PARAMS: TrafficParams = { minGapM: 2, passDelaySec: 3, maxAccelMps2: 1.5, maxDecelMps2: 3 };

export interface TrafficVehicle {
  readonly id: number;
  readonly lengthM: number;
  /** Directed edges to drive, consecutive edges connected. */
  readonly route: readonly number[];
  readonly departAt: SimTime;
}

export interface VehiclePosition {
  readonly id: number;
  readonly edge: number;
  readonly lane: number;
  /** Distance of the vehicle's front from the edge's start node (m). */
  readonly s: number;
  readonly speedMps: number;
}

export type TrafficEvent =
  | { readonly kind: 'Departed'; readonly id: number; readonly t: SimTime }
  | { readonly kind: 'Arrived'; readonly id: number; readonly t: SimTime };

/** Opaque traffic state. */
export interface Traffic {
  readonly graph: RoadGraph;
}

/** Speed limit for an edge at a time (m/s), from the speed model. */
export type SpeedLimitFn = (edge: number, t: SimTime) => number;

export function createTraffic(g: RoadGraph, speedLimit: SpeedLimitFn, params?: TrafficParams): Traffic {
  return notImplemented('createTraffic', g, speedLimit, params);
}

/** Throws if the id exists or the route is empty or disconnected. */
export function addVehicle(tr: Traffic, v: TrafficVehicle): void {
  notImplemented('addVehicle', tr, v);
}

/** Marks a vehicle as stopped for service (it holds its position) or releases it. */
export function setStopped(tr: Traffic, id: number, stopped: boolean): void {
  notImplemented('setStopped', tr, id, stopped);
}

/**
 * Advances from t to t + dtSec. Invariants: on any edge lane, follower front ≤ leader front − leader length −
 * minGapM; each junction is reserved by at most one vehicle at a time; a vehicle enters an edge only if its tail has
 * room. Vehicles that have not departed or have arrived are not on the network.
 */
export function stepTraffic(tr: Traffic, t: SimTime, dtSec: number): TrafficEvent[] {
  return notImplemented('stepTraffic', tr, t, dtSec);
}

export function positions(tr: Traffic): VehiclePosition[] {
  return notImplemented('positions', tr);
}

/** Current junction reservations (graph node → vehicle id). */
export function reservations(tr: Traffic): ReadonlyMap<number, number> {
  return notImplemented('reservations', tr);
}
