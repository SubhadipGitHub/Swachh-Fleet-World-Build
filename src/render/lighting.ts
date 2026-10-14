export type LightPhase = 'day' | 'twilight' | 'night';
export type LightOverride = 'auto' | 'day' | 'night';

export interface Lighting {
  readonly phase: LightPhase;
  /** Directional sun intensity. */
  readonly sun: number;
  /** Hemisphere (sky) intensity. */
  readonly sky: number;
  /** Street lights and vehicle lights on (lit windows went with the buildings, CR-1). */
  readonly nightLights: boolean;
}

const SUN_MAX = 2.2;
const DAY: Lighting = { phase: 'day', sun: SUN_MAX, sky: 1.2, nightLights: false };
const NIGHT: Lighting = { phase: 'night', sun: 0.15, sky: 0.35, nightLights: true };
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Lighting from the sun's altitude (X-2, M2-6): day above +6°, twilight from −6° to +6°, night below −6°. The
 * override (the top bar's toggle) forces day or night for viewing only. Sun and sky intensities never increase as the
 * sun sinks; night lights are on in twilight below 0° and at night.
 */
export function lightingFor(sunAltitudeDeg: number, override: LightOverride = 'auto'): Lighting {
  if (override === 'day') return DAY;
  if (override === 'night') return NIGHT;
  const alt = sunAltitudeDeg;
  const phase: LightPhase = alt > 6 ? 'day' : alt < -6 ? 'night' : 'twilight';
  return {
    phase,
    sun: SUN_MAX * clamp01(Math.sin((alt * Math.PI) / 180) * 2.5),
    sky: 0.25 + 0.95 * clamp01((alt + 12) / 30),
    nightLights: alt < 0,
  };
}
