import type { WardShape } from '../geo/snapshot';
import type { Point } from '../geo/quantise';

/** Area codes used in display ids (requirements D-7), by ward. */
const WARD_CODES: Readonly<Record<string, { long: string; short: string }>> = {
  'South-29': { long: 'KMW', short: 'KW' },
  'South-28': { long: 'KME', short: 'KE' },
  'South-30': { long: 'JKS', short: 'JK' },
  'South-72': { long: 'HSR', short: 'HS' },
  'South-71': { long: 'AGR', short: 'AG' },
  'South-68': { long: 'MGP', short: 'MP' },
  'South-69': { long: 'HSP', short: 'HP' },
};
const FALLBACK = { long: 'BLR', short: 'BL' };

function inside(x: number, y: number, ring: readonly Point[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The ward containing a point, or the nearest ward by vertex distance if none does (streets in the buffer). */
export function wardAt(wards: readonly WardShape[], x: number, y: number): WardShape | null {
  for (const w of wards) if (w.rings.some((r) => inside(x, y, r))) return w;
  let best: WardShape | null = null;
  let bestD = Infinity;
  for (const w of wards) {
    for (const r of w.rings) {
      for (const [px, py] of r) {
        const d = Math.hypot(px - x, py - y);
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      }
    }
  }
  return best;
}

export function wardCode(ward: WardShape | null, length: 'long' | 'short'): string {
  return (ward ? WARD_CODES[ward.key] : undefined)?.[length] ?? FALLBACK[length];
}

/** Display ids (D-7): AT-HSR-031, CP-BLR-S-07, CR-BLR-S-02, bins KM-114 style, black spots GVP-HSR-012. Synthetic. */
export class DisplayIds {
  private readonly counters = new Map<string, number>();

  private next(prefix: string): number {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return n;
  }

  autoTipper(ward: WardShape | null): string {
    const code = wardCode(ward, 'long');
    return `AT-${code}-${String(this.next(`AT-${code}`)).padStart(3, '0')}`;
  }

  compactor(): string {
    return `CP-BLR-S-${String(this.next('CP')).padStart(2, '0')}`;
  }

  crew(): string {
    return `CR-BLR-S-${String(this.next('CR')).padStart(2, '0')}`;
  }

  bin(ward: WardShape | null): string {
    const code = wardCode(ward, 'short');
    return `${code}-${String(100 + this.next(`BIN-${code}`)).padStart(3, '0')}`;
  }

  blackSpot(ward: WardShape | null): string {
    const code = wardCode(ward, 'long');
    return `GVP-${code}-${String(this.next(`GVP-${code}`)).padStart(3, '0')}`;
  }

  transferPoint(id: number): string {
    return `TP-${String(id + 1).padStart(2, '0')}`;
  }
}
