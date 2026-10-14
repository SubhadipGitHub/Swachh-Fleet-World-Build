import type { SimTime } from './clock';
import type { SensorStatus } from './sensors';

/** The single event stream the tracker, alerts and KPIs are computed from (AD-5). */
export type SimEvent =
  | { readonly t: SimTime; readonly kind: 'ShiftStarted'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'VehicleAbsent'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'StopServed'; readonly vehicleId: number; readonly target: StopTarget; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'StopSkipped'; readonly vehicleId: number; readonly target: StopTarget; readonly reason: SkipReason }
  | { readonly t: SimTime; readonly kind: 'Tipped'; readonly vehicleId: number; readonly transferPointId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'Weighed'; readonly vehicleId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'Diverted'; readonly vehicleId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'Unloaded'; readonly vehicleId: number; readonly site: 'KCDC' | 'Landfill'; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'BrokenDown'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'Repaired'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'RouteDeviation'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'BlackSpotActivated'; readonly blackSpotId: number }
  | { readonly t: SimTime; readonly kind: 'BlackSpotCleared'; readonly blackSpotId: number; readonly kg: number }
  | { readonly t: SimTime; readonly kind: 'SensorReading'; readonly binId: number; readonly fillPct: number | null; readonly status: SensorStatus }
  | { readonly t: SimTime; readonly kind: 'ShiftEnded'; readonly vehicleId: number }
  | { readonly t: SimTime; readonly kind: 'RoadClosed'; readonly spotId: number; readonly edges: readonly number[] }
  | { readonly t: SimTime; readonly kind: 'RoadReopened'; readonly spotId: number }
  /** M3-D10: a Dynamic plan took effect. `deferredMustServe` counts must-serve streets no tipper had time for. */
  | { readonly t: SimTime; readonly kind: 'Replanned'; readonly cause: PlanCause; readonly vehicleIds: readonly number[]; readonly deferredMustServe: number }
  /** M3-D9: the solver failed, so today falls back to the static beats. */
  | { readonly t: SimTime; readonly kind: 'PlanFailed'; readonly cause: PlanCause; readonly reason: string };

/** What triggered a plan (M3-D9). */
export type PlanCause = 'daily' | 'breakdown' | 'closure' | 'policy';

export type StopTarget = { readonly type: 'segment'; readonly id: number } | { readonly type: 'bin'; readonly id: number };
export type SkipReason = 'absent' | 'non-compliance' | 'breakdown' | 'shift-ended' | 'road-closed' | 'early-return';

export type SimEventKind = SimEvent['kind'];

/** JSON with object keys sorted at every level, so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/**
 * Streaming 64-bit FNV-1a in four 16-bit limbs (no BigInt, so hashing a whole day stays fast).
 * Prime 2⁴⁰ + 0x1b3: h × prime = (h × 0x1b3) + (h ≪ 40).
 */
export class Fnv1a64 {
  private h0 = 0x2325;
  private h1 = 0x8422;
  private h2 = 0x9ce4;
  private h3 = 0xcbf2;

  byte(b: number): void {
    this.h0 ^= b & 0xff;
    const t0 = this.h0 * 0x1b3;
    let t1 = this.h1 * 0x1b3;
    let t2 = this.h2 * 0x1b3 + (this.h0 << 8);
    const t3 = this.h3 * 0x1b3 + (this.h1 << 8);
    t1 += t0 >>> 16;
    this.h0 = t0 & 0xffff;
    t2 += t1 >>> 16;
    this.h1 = t1 & 0xffff;
    this.h3 = (t3 + (t2 >>> 16)) & 0xffff;
    this.h2 = t2 & 0xffff;
  }

  /** Feeds a string as UTF-8. */
  text(s: string): void {
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      if (c < 0x80) this.byte(c);
      else if (c < 0x800) {
        this.byte(0xc0 | (c >> 6));
        this.byte(0x80 | (c & 63));
      } else if (c < 0x10000) {
        this.byte(0xe0 | (c >> 12));
        this.byte(0x80 | ((c >> 6) & 63));
        this.byte(0x80 | (c & 63));
      } else {
        this.byte(0xf0 | (c >> 18));
        this.byte(0x80 | ((c >> 12) & 63));
        this.byte(0x80 | ((c >> 6) & 63));
        this.byte(0x80 | (c & 63));
      }
    }
  }

  hex(): string {
    return [this.h3, this.h2, this.h1, this.h0].map((l) => l.toString(16).padStart(4, '0')).join('');
  }
}

/** 64-bit FNV-1a over each event's canonical JSON (keys sorted), as 16 lower-case hex digits. Order matters. */
export function hashEvents(events: readonly SimEvent[]): string {
  const h = new Fnv1a64();
  for (const e of events) {
    h.text(canonicalJson(e));
    h.byte(0x0a);
  }
  return h.hex();
}
