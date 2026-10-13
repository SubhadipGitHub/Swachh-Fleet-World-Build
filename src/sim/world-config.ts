import { notImplemented } from '../shared/not-implemented';
import type { Calibration } from '../config/calibration';
import type { ClusterScale } from '../config/derive';
import type { WeatherMode } from '../config/scenario';
import type { WorldConfig } from './world';

/**
 * The live world's configuration from the calibration and derived scale:
 * - fleet: scale.autoTippers auto-tippers, scale.compactors compactors, 2 clearance crews; tipper shift 06:00–14:00,
 *   compactor shift 07:00–19:00 (L-1 step 4)
 * - householdKgPerDay = perCapitaKgPerDay × personsPerHousehold
 * - kcdcIntakeCapKg = kcdcIntakeCapTpd × 1000
 * - speed model from the TomTom calibration; weather factor 0.7 in a monsoon downpour, else 1 (X-1)
 * - sensors: 3-point noise, faults about 1% of readings
 */
export function defaultWorldConfig(cal: Calibration, scale: ClusterScale, weather: WeatherMode): WorldConfig {
  return notImplemented('defaultWorldConfig', cal, scale, weather);
}
