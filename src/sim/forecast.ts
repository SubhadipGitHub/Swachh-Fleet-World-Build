import { DAY_SEC, dayIndex, secondOfDay, type SimTime } from './clock';
import { accumulatedKg, type DailyProfile } from './generation';
import type { SensorStatus } from './sensors';

export interface FillReading {
  readonly t: SimTime;
  readonly pct: number;
}

/**
 * "Predicted full at" for the tables (M2-9, `synthetic`): a straight line through the last two readings, extended to
 * 100%. Null with fewer than two readings, when the fill is flat or falling, or when the bin is already full (the
 * last reading is at least 100%).
 */
export function predictFullAt(readings: readonly FillReading[]): SimTime | null {
  const n = readings.length;
  if (n < 2) return null;
  const a = readings[n - 2]!;
  const b = readings[n - 1]!;
  if (b.pct >= 100 || b.t <= a.t || b.pct <= a.pct) return null;
  return Math.round(b.t + ((100 - b.pct) * (b.t - a.t)) / (b.pct - a.pct));
}

// --- M3: forecasts for the Dynamic policy (architecture M3-D5) --------------------------------------------------

export type Confidence = 'normal' | 'low';

export interface FillForecast {
  readonly pct: number;
  readonly confidence: Confidence;
}

/** One sensor reading as the operator sees it (status from the sensor; pct null when offline). */
export interface ObservedReading {
  readonly t: SimTime;
  readonly pct: number | null;
  readonly status: SensorStatus;
}

/**
 * Hour-of-week fill-rate profile for one sensored point (168 buckets, exponential smoothing with `alpha`). It learns
 * from the rate between consecutive good readings with no service in between (`servedSincePrevious` comes from the
 * GPS service log), filing each rate under the hour the interval starts in. With under 24 h of good history it
 * predicts with M2's two-point line instead. Confidence is `low` when the latest reading is stuck or offline, or the
 * history is under 24 h.
 */
export class FillProfile {
  private readonly rates = new Float64Array(HOURS_PER_WEEK).fill(Number.NaN);
  /** The last good reading: the base for predictions. */
  private base: { t: SimTime; pct: number } | null = null;
  /** The previous good reading, if nothing broke the run since (a service or a bad reading). */
  private learnFrom: { t: SimTime; pct: number } | null = null;
  /** The last two good readings since the last service, for the short-history line. */
  private recent: { t: SimTime; pct: number }[] = [];
  private firstGoodAt: SimTime | null = null;
  private lastStatus: SensorStatus = 'ok';

  /** `startWeekday`: 0 = Monday … 6 = Sunday, for t = 0. */
  constructor(
    readonly startWeekday: number,
    readonly alpha = 0.3,
  ) {}

  observe(reading: ObservedReading, servedSincePrevious: boolean): void {
    this.lastStatus = reading.status;
    if (reading.status !== 'ok' || reading.pct === null) {
      this.learnFrom = null;
      return;
    }
    const now = { t: reading.t, pct: reading.pct };
    if (servedSincePrevious) {
      this.recent = [];
    } else if (this.learnFrom && now.t > this.learnFrom.t) {
      const rate = ((now.pct - this.learnFrom.pct) * 3600) / (now.t - this.learnFrom.t);
      const h = hourOfWeek(this.learnFrom.t, this.startWeekday);
      const old = this.rates[h]!;
      this.rates[h] = Number.isNaN(old) ? rate : old + this.alpha * (rate - old);
    }
    this.firstGoodAt ??= now.t;
    this.learnFrom = now;
    this.base = now;
    this.recent.push(now);
    if (this.recent.length > 2) this.recent.shift();
  }

  /** Seconds between the first and the latest good reading. */
  historySec(): number {
    return this.base && this.firstGoodAt !== null ? this.base.t - this.firstGoodAt : 0;
  }

  /** Learned rate (fill points per hour) for an hour-of-week bucket, or null if never observed. */
  rateAt(hourOfWeek: number): number | null {
    const r = this.rates[hourOfWeek];
    return r === undefined || Number.isNaN(r) ? null : r;
  }

  /** Predicted fill at `at` (clamped to 0–150), or null before any good reading. */
  predict(at: SimTime): FillForecast | null {
    const base = this.base;
    if (!base) return null;
    const clamp = (v: number): number => Math.min(150, Math.max(0, v));
    if (this.historySec() < DAY_SEC) {
      const [a, b] = this.recent;
      const slope = a && b && b.t > a.t ? (b.pct - a.pct) / (b.t - a.t) : 0;
      return { pct: clamp(base.pct + slope * Math.max(0, at - base.t)), confidence: 'low' };
    }
    let known = 0;
    let sum = 0;
    for (const r of this.rates) {
      if (Number.isNaN(r)) continue;
      known++;
      sum += r;
    }
    const fallback = known > 0 ? sum / known : 0;
    let pct = base.pct;
    for (let t = base.t; t < at; ) {
      const next = Math.min(at, (Math.floor(t / 3600) + 1) * 3600);
      const r = this.rates[hourOfWeek(t, this.startWeekday)]!;
      pct += ((Number.isNaN(r) ? fallback : r) * (next - t)) / 3600;
      t = next;
    }
    return { pct: clamp(pct), confidence: this.lastStatus === 'ok' ? 'normal' : 'low' };
  }
}

const HOURS_PER_WEEK = 168;

/** Hour-of-week bucket (0–167) of a time, given the weekday of t = 0 (0 = Monday). */
export function hourOfWeek(t: SimTime, startWeekday: number): number {
  return ((dayIndex(t) + startWeekday) % 7) * 24 + Math.floor(secondOfDay(t) / 3600);
}

/**
 * Street backlog estimate (no sensors): households × r̂ (kg per household per day) × the share of the published
 * household daily curve between `lastServedAt` and `at`.
 */
export function segmentBacklogKg(households: number, rHat: number, lastServedAt: SimTime, at: SimTime, profile: DailyProfile): number {
  if (at <= lastServedAt) return 0;
  return accumulatedKg(households * rHat, profile, lastServedAt, at);
}

/**
 * r̂ learner: starts at a prior (the calibration's per-capita figure × persons per household) and is updated daily by
 * exponential smoothing from weighed kg ÷ household-days collected, so surges are learned, not given.
 */
export class RateLearner {
  private v: number;

  constructor(
    readonly prior: number,
    readonly alpha = 0.3,
  ) {
    this.v = prior;
  }

  update(weighedKg: number, householdDaysCollected: number): void {
    if (householdDaysCollected <= 0 || weighedKg <= 0) return;
    this.v += this.alpha * (weighedKg / householdDaysCollected - this.v);
  }

  value(): number {
    return this.v;
  }
}

/** Running mean absolute error of forecasts against readings, in fill points (shown in the Data sources dialog). */
export class ForecastError {
  private n = 0;
  private sum = 0;

  record(predictedPct: number, actualPct: number): void {
    this.n++;
    this.sum += Math.abs(predictedPct - actualPct);
  }

  count(): number {
    return this.n;
  }

  /** Null before any forecast was scored. */
  mae(): number | null {
    return this.n === 0 ? null : this.sum / this.n;
  }
}
