import type { SimTime } from './clock';
import type { SensorReading } from './sensors';

/**
 * What a routing policy may see (AD-5, truth vs observation). It deliberately has no true fill levels, so the
 * dynamic policy cannot cheat. tests/unit/sim/observation.test.ts checks this at the type level.
 */
export interface BinObservation {
  readonly binId: number;
  readonly reading: SensorReading;
  readonly readAt: SimTime;
}

export interface FleetObservation {
  readonly vehicleId: number;
  readonly kind: 'auto-tipper' | 'compactor' | 'crew';
  readonly available: boolean;
}

export interface Observation {
  readonly t: SimTime;
  readonly bins: readonly BinObservation[];
  readonly fleet: readonly FleetObservation[];
  readonly closedEdges: readonly number[];
}
