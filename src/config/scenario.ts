import type { IsoDate } from './sources';

export type WeatherMode = 'clear' | 'monsoon' | 'haze' | 'heatwave';
export type RoutingPolicy = 'static' | 'dynamic';

/** Scenario levers used in M1. Later milestones add the rest of requirements §7 (AD-12). */
export interface Levers {
  /** Share of auto-tippers absent each day, 0–1 (S-3). */
  readonly tipperAbsenceRate: number;
  /** Chance per vehicle per shift of a breakdown, 0–1 (S-4). */
  readonly breakdownChancePerShift: number;
  /** Chance a stop is skipped by a non-compliant driver, 0–1 (S-5). */
  readonly skipChance: number;
}

/** A complete, reproducible run description (SC-4). */
export interface ScenarioSpec {
  readonly v: 1;
  readonly seed: number;
  readonly startDate: IsoDate;
  readonly days: number;
  readonly weather: WeatherMode;
  readonly policy: RoutingPolicy;
  readonly levers: Levers;
}
