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
  const attempts: { endpoint: string; reason: string }[] = [];
  for (const endpoint of options.endpoints) {
    for (let attempt = 0; attempt < options.attemptsPerEndpoint; attempt++) {
      if (attempt > 0) await options.sleep(options.backoffMs * 2 ** (attempt - 1));
      try {
        const res = await options.fetchFn(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: new URLSearchParams({ data: query }).toString(),
        });
        const text = await res.text();
        if (res.status !== 200) {
          attempts.push({ endpoint, reason: `HTTP ${res.status}` });
          continue;
        }
        try {
          return JSON.parse(text) as unknown;
        } catch {
          attempts.push({ endpoint, reason: `Not JSON: ${text.slice(0, 120).replace(/\s+/g, ' ')}` });
        }
      } catch (e) {
        attempts.push({ endpoint, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  throw new OverpassError(attempts);
}

/** Splits a [south, west, north, east] box into rows × cols tiles that exactly cover it, row-major from the south-west. */
export function splitBbox(bbox: readonly [number, number, number, number], rows: number, cols: number): [number, number, number, number][] {
  if (!(rows >= 1 && cols >= 1 && Number.isInteger(rows) && Number.isInteger(cols))) throw new RangeError('rows and cols must be positive integers');
  const [s, w, n, e] = bbox;
  const lat = (i: number): number => (i === rows ? n : s + ((n - s) * i) / rows);
  const lon = (j: number): number => (j === cols ? e : w + ((e - w) * j) / cols);
  const tiles: [number, number, number, number][] = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) tiles.push([lat(i), lon(j), lat(i + 1), lon(j + 1)]);
  return tiles;
}
