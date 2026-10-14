/** Coordinates are stored as Int16 multiples of this step (architecture AD-3): ±8,191.75 m of range. */
export const QUANT_STEP_M = 0.25;

/** Largest absolute coordinate that fits: 32,767 × 0.25 m. */
export const QUANT_MAX_ABS_M = 32767 * QUANT_STEP_M;

export type Point = readonly [x: number, y: number];
export type Ring = readonly Point[];

/**
 * Rings or polylines, quantised and delta-encoded. Within each ring the first vertex is absolute and the rest are
 * deltas from the previous vertex, all in units of QUANT_STEP_M. `starts` has one entry per ring plus a final entry
 * equal to the vertex count, so ring i spans vertices starts[i] .. starts[i+1]-1. `coords` holds x,y pairs.
 */
export interface EncodedRings {
  readonly coords: Int16Array;
  readonly starts: Uint32Array;
}

const I16_MIN = -32768;
const I16_MAX = 32767;

function quantum(v: number): number {
  if (!Number.isFinite(v)) throw new RangeError(`Coordinate is not finite: ${v}`);
  if (Math.abs(v) > QUANT_MAX_ABS_M) throw new RangeError(`Coordinate ${v} m is beyond ±${QUANT_MAX_ABS_M} m`);
  return Math.round(v / QUANT_STEP_M);
}

function checkDelta(d: number): number {
  if (d < I16_MIN || d > I16_MAX) throw new RangeError(`Delta of ${d * QUANT_STEP_M} m does not fit in Int16`);
  return d;
}

/** Throws RangeError if a coordinate is beyond QUANT_MAX_ABS_M or a delta does not fit in Int16. */
export function encodeRings(rings: readonly Ring[]): EncodedRings {
  const total = rings.reduce((n, r) => n + r.length, 0);
  const coords = new Int16Array(total * 2);
  const starts = new Uint32Array(rings.length + 1);
  let v = 0;
  rings.forEach((ring, i) => {
    starts[i] = v;
    let px = 0;
    let py = 0;
    ring.forEach(([x, y], j) => {
      const qx = quantum(x);
      const qy = quantum(y);
      coords[2 * v] = j === 0 ? qx : checkDelta(qx - px);
      coords[2 * v + 1] = j === 0 ? qy : checkDelta(qy - py);
      px = qx;
      py = qy;
      v++;
    });
  });
  starts[rings.length] = v;
  return { coords, starts };
}

export function decodeRings(encoded: EncodedRings): Point[][] {
  const { coords, starts } = encoded;
  const out: Point[][] = [];
  for (let i = 0; i + 1 < starts.length; i++) {
    const ring: Point[] = [];
    let qx = 0;
    let qy = 0;
    for (let v = starts[i]!; v < starts[i + 1]!; v++) {
      const dx = coords[2 * v]!;
      const dy = coords[2 * v + 1]!;
      if (v === starts[i]) {
        qx = dx;
        qy = dy;
      } else {
        qx += dx;
        qy += dy;
      }
      ring.push([qx * QUANT_STEP_M, qy * QUANT_STEP_M]);
    }
    out.push(ring);
  }
  return out;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map<string, number>(Array.from({ length: ALPHABET.length }, (_, i) => [ALPHABET.charAt(i), i]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!;
    out += c === undefined ? '=' : ALPHABET[n & 63]!;
  }
  return out;
}

/** Throws SyntaxError on characters outside the base64 alphabet. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    const v = LOOKUP.get(ch);
    if (v === undefined) throw new SyntaxError(`Invalid base64 character: ${JSON.stringify(ch)}`);
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
