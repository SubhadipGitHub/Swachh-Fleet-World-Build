import type { Calibration } from '../config/calibration';
import type { ClusterScale } from '../config/derive';
import type { Levers, WeatherMode } from '../config/scenario';
import { buildSpeedModel } from '../routing/travel-time';
import type { WorldConfig } from './world';

/** Auto-tipper payload (`assumed`: a typical 1 t auto-tipper). */
const TIPPER_PAYLOAD_KG = 1000;
/** Clearance crews (tipper lorry + mini excavator) for the cluster (`assumed`). */
const CREWS = 2;
const MONSOON_SPEED_FACTOR = 0.7;

/**
 * The live world's configuration from the calibration and derived scale:
 * - fleet: scale.autoTippers auto-tippers, scale.compactors compactors, 2 clearance crews; tipper shift 06:00–14:00,
 *   compactor shift 07:00–19:00 (L-1 step 4)
 * - householdKgPerDay = perCapitaKgPerDay × personsPerHousehold
 * - kcdcIntakeCapKg = kcdcIntakeCapTpd × 1000
 * - speed model from the TomTom calibration; weather factor 0.7 in a monsoon downpour, else 1 (X-1)
 * - sensors: 3-point noise, faults about 1% of readings
 * - M3-D2: generation variability, leakage of stale backlog and the dump radius from the calibration
 */
export function defaultWorldConfig(cal: Calibration, scale: ClusterScale, weather: WeatherMode): WorldConfig {
  return {
    fleet: {
      autoTippers: scale.autoTippers.value,
      compactors: scale.compactors.value,
      crews: CREWS,
      tipperPayloadKg: TIPPER_PAYLOAD_KG,
      compactorPayloadKg: cal.compactorPayloadT.value * 1000,
      tipperShift: [6 * 3600, 14 * 3600],
      compactorShift: [7 * 3600, 19 * 3600],
    },
    sensor: { noiseSdPct: 3, faultChancePerReading: 0.0005, recoverChancePerReading: 0.01 },
    speed: buildSpeedModel(
      { freeFlowRefKmh: cal.freeFlowRefSpeedKmh.value, morningPeakKmh: cal.morningPeakSpeedKmh.value, eveningPeakKmh: cal.eveningPeakSpeedKmh.value },
      weather === 'monsoon' ? MONSOON_SPEED_FACTOR : 1,
    ),
    householdKgPerDay: scale.perCapitaKgPerDay.value * cal.personsPerHousehold.value,
    kcdcIntakeCapKg: cal.kcdcIntakeCapTpd.value * 1000,
    blackSpotBaseChancePerHour: 0.002,
    dieselPriceInrPerL: cal.dieselPriceInrPerL.value,
    // M3-D2
    generationSigma: cal.generationSigma.value,
    leakageSharePerDay: cal.leakageSharePerDay.value,
    dumpRadiusM: cal.dumpRadiusM.value,
  };
}

/**
 * M3-D3: the calibrated Static baseline's levers. Absence comes from the calibration (`derived` from the real city
 * figure); skip and early-return chances are the calibrated non-compliance intensity (`derived`, calibrated to the
 * B.PAC 2023 "< 60% collected" figure); breakdowns stay at their default.
 */
export function baselineLevers(cal: Calibration): Levers {
  return { tipperAbsenceRate: cal.tipperAbsenceRate.value, breakdownChancePerShift: cal.breakdownChancePerShift.value, skipChance: cal.skipChance.value, earlyReturnChance: cal.earlyReturnChance.value };
}
