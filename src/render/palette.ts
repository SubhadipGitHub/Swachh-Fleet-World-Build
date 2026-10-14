import { Color } from 'three';

/** Clay palette (D10): graphite ground, clay roads, one civic-green accent. */
export const PALETTE = {
  background: new Color('#1C1F22'),
  ground: new Color('#252a27'),
  accent: new Color('#22A86B'),
  water: new Color('#3d6f8e'),
  park: new Color('#3f6b45'),
  wardLine: new Color('#8fd3b0'),
  road: {
    trunk: new Color('#e2dccf'),
    primary: new Color('#d6cfc0'),
    secondary: new Color('#c4bdae'),
    tertiary: new Color('#b0aa9d'),
    unclassified: new Color('#9c978c'),
    residential: new Color('#8f8a80'),
    living_street: new Color('#8f8a80'),
    service: new Color('#7a766e'),
  },
  vehicle: {
    'auto-tipper': new Color('#22A86B'),
    compactor: new Color('#e8a33d'),
    crew: new Color('#d0574a'),
  },
  fill: { ok: new Color('#3fbf7f'), warn: new Color('#e8b13d'), full: new Color('#e0533f'), offline: new Color('#6f7378') },
} as const;

/** Bin colour from the reported fill (%), or grey when there is no reading. */
export function fillColour(reportedPct: number): Color {
  if (reportedPct < 0) return PALETTE.fill.offline;
  if (reportedPct >= 90) return PALETTE.fill.full;
  if (reportedPct >= 70) return PALETTE.fill.warn;
  return PALETTE.fill.ok;
}
