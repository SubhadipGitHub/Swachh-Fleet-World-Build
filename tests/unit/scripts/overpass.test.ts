import { describe, expect, it } from 'vitest';
import { OverpassError, USER_AGENT, overpassQuery, splitBbox, type OverpassOptions } from '../../../scripts/data/lib/overpass';

// Architecture AD-3 and risk R-7: polite Overpass access with retries, backoff and mirror fallback. No network here.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function htmlResponse(status: number): Response {
  return new Response('<html><body>runtime error: timeout</body></html>', { status, headers: { 'content-type': 'text/html' } });
}

function options(responses: (() => Promise<Response>)[], overrides: Partial<OverpassOptions> = {}): OverpassOptions & { calls: { url: string; init: RequestInit | undefined }[]; sleeps: number[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const sleeps: number[] = [];
  let i = 0;
  return {
    endpoints: ['https://a.example/api/interpreter', 'https://b.example/api/interpreter'],
    attemptsPerEndpoint: 2,
    backoffMs: 100,
    fetchFn: (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url instanceof Request ? url.url : url.toString(), init });
      const next = responses[i++];
      if (!next) throw new Error('unexpected extra fetch');
      return next();
    },
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    calls,
    sleeps,
    ...overrides,
  };
}

describe('overpassQuery', () => {
  it('POSTs the query form-encoded with the User-Agent and returns the parsed JSON', async () => {
    const o = options([() => Promise.resolve(jsonResponse({ elements: [1] }))]);
    await expect(overpassQuery('[out:json];node(1);out;', o)).resolves.toEqual({ elements: [1] });
    expect(o.calls).toHaveLength(1);
    const { url, init } = o.calls[0]!;
    expect(url).toBe('https://a.example/api/interpreter');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT);
    expect(new Headers(init?.headers).get('content-type')).toMatch(/application\/x-www-form-urlencoded/);
    const body = init?.body;
    const form = body instanceof URLSearchParams ? body : new URLSearchParams(typeof body === 'string' ? body : '');
    expect(form.get('data')).toBe('[out:json];node(1);out;');
  });

  it('retries the same endpoint with exponential backoff, then succeeds', async () => {
    const o = options([() => Promise.resolve(htmlResponse(504)), () => Promise.resolve(jsonResponse({ ok: true }))]);
    await expect(overpassQuery('q', o)).resolves.toEqual({ ok: true });
    expect(o.calls.map((c) => c.url)).toEqual(['https://a.example/api/interpreter', 'https://a.example/api/interpreter']);
    expect(o.sleeps).toEqual([100]);
  });

  it('treats a 200 response that is not JSON (Overpass error page) as a failure', async () => {
    const o = options([() => Promise.resolve(htmlResponse(200)), () => Promise.resolve(jsonResponse({ ok: 1 }))]);
    await expect(overpassQuery('q', o)).resolves.toEqual({ ok: 1 });
    expect(o.calls).toHaveLength(2);
  });

  it('falls back to the next endpoint after exhausting attempts, resetting the backoff', async () => {
    const o = options([
      () => Promise.reject(new Error('ETIMEDOUT')),
      () => Promise.resolve(htmlResponse(429)),
      () => Promise.resolve(jsonResponse({ from: 'b' })),
    ]);
    await expect(overpassQuery('q', o)).resolves.toEqual({ from: 'b' });
    expect(o.calls.map((c) => c.url)).toEqual(['https://a.example/api/interpreter', 'https://a.example/api/interpreter', 'https://b.example/api/interpreter']);
    expect(o.sleeps).toEqual([100]);
  });

  it('throws OverpassError listing every failed attempt when all endpoints fail', async () => {
    const fail = (): Promise<Response> => Promise.resolve(htmlResponse(504));
    const o = options([fail, fail, fail, fail]);
    const err = await overpassQuery('q', o).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OverpassError);
    expect((err as OverpassError).attempts).toHaveLength(4);
    expect((err as OverpassError).attempts.map((a) => a.endpoint)).toEqual([
      'https://a.example/api/interpreter',
      'https://a.example/api/interpreter',
      'https://b.example/api/interpreter',
      'https://b.example/api/interpreter',
    ]);
    expect(o.sleeps).toEqual([100, 100]);
  });

  it('doubles the wait on each further retry of the same endpoint', async () => {
    const fail = (): Promise<Response> => Promise.resolve(htmlResponse(504));
    const o = options([fail, fail, fail, () => Promise.resolve(jsonResponse({}))], { endpoints: ['https://a.example/api/interpreter'], attemptsPerEndpoint: 4 });
    await overpassQuery('q', o);
    expect(o.sleeps).toEqual([100, 200, 400]);
  });
});

describe('splitBbox', () => {
  it('covers the box exactly, row-major from the south-west', () => {
    const tiles = splitBbox([12.89, 77.6, 12.95, 77.66], 2, 2);
    expect(tiles).toHaveLength(4);
    const close = (a: number[], b: number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12));
    close(tiles[0]!, [12.89, 77.6, 12.92, 77.63]);
    close(tiles[1]!, [12.89, 77.63, 12.92, 77.66]);
    close(tiles[2]!, [12.92, 77.6, 12.95, 77.63]);
    close(tiles[3]!, [12.92, 77.63, 12.95, 77.66]);
  });

  it('shares edges exactly so no gap can open between tiles', () => {
    const tiles = splitBbox([12.893, 77.608, 12.945, 77.66], 3, 3);
    expect(tiles[0]![2]).toBe(tiles[3]![0]);
    expect(tiles[0]![3]).toBe(tiles[1]![1]);
    expect(tiles[8]![2]).toBe(12.945);
    expect(tiles[8]![3]).toBe(77.66);
  });

  it('rejects non-positive tile counts', () => {
    expect(() => splitBbox([0, 0, 1, 1], 0, 1)).toThrow(RangeError);
  });
});
