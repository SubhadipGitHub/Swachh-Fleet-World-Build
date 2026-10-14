/** Motion trails appear at 120× and above (AD-10, R-3). */
export const TRAIL_MIN_SPEED = 120;
/** Trails keep this many simulated seconds of movement. */
export const TRAIL_SECONDS = 20;

export function trailsEnabled(speed: number): boolean {
  return speed >= TRAIL_MIN_SPEED;
}

/** A fixed-size ring buffer of timed positions for one vehicle. */
export class TrailBuffer {
  private points: { t: number; x: number; y: number }[] = [];

  constructor(readonly capacity: number) {
    if (!(capacity >= 2)) throw new RangeError('capacity must be at least 2');
  }

  /** Adds a point; a time earlier than the last point (a jump back) clears the trail first. */
  push(t: number, x: number, y: number): void {
    const last = this.points[this.points.length - 1];
    if (last && t < last.t) this.points = [];
    this.points.push({ t, x, y });
    if (this.points.length > this.capacity) this.points.shift();
  }

  /** Points no older than `seconds` before `now`, oldest first. */
  recent(now: number, seconds: number): { t: number; x: number; y: number }[] {
    return this.points.filter((p) => p.t >= now - seconds && p.t <= now).map((p) => ({ ...p }));
  }

  clear(): void {
    this.points = [];
  }
}
