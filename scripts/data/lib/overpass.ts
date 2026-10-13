import { notImplemented } from '../../../src/shared/not-implemented';

/** Public Overpass endpoints, tried in order (AD-3, risk R-7). */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

export const USER_AGENT = 'SwachhFleetWorld-data/0.1 (independent simulation; contact via repository)';

export interface OverpassOptions {
  readonly endpoints: readonly string[];
  /** Attempts per endpoint before moving to the next one. */
  readonly attemptsPerEndpoint: number;
  /** Wait before retry n (1-based) on the same endpoint: backoffMs × 2ⁿ⁻¹. No wait when moving to the next endpoint. */
  readonly backoffMs: number;
  readonly fetchFn: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Thrown when every endpoint failed. `attempts` lists each failure in order. */
export class OverpassError extends Error {
  constructor(readonly attempts: readonly { readonly endpoint: string; readonly reason: string }[]) {
    super(`Overpass failed after ${attempts.length} attempts`);
    this.name = 'OverpassError';
  }
}

/**
 * POSTs `data=<query>` (form-encoded) with the User-Agent header. A response counts as a failure if it is not HTTP
 * 200, not JSON, or the fetch throws (timeouts included). Failures are retried with backoff, then the next endpoint
 * is tried. Returns the parsed JSON of the first success.
 */
export async function overpassQuery(query: string, options: OverpassOptions): Promise<unknown> {
  return Promise.resolve(notImplemented('overpassQuery', query, options));
}

/** Splits a [south, west, north, east] box into rows × cols tiles that exactly cover it, row-major from the south-west. */
export function splitBbox(bbox: readonly [number, number, number, number], rows: number, cols: number): [number, number, number, number][] {
  return notImplemented('splitBbox', bbox, rows, cols);
}
