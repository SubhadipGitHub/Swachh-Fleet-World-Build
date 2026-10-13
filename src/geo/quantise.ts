import { notImplemented } from '../shared/not-implemented';

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

/** Throws RangeError if a coordinate is beyond QUANT_MAX_ABS_M or a delta does not fit in Int16. */
export function encodeRings(rings: readonly Ring[]): EncodedRings {
  return notImplemented('encodeRings', rings);
}

export function decodeRings(encoded: EncodedRings): Point[][] {
  return notImplemented('decodeRings', encoded);
}

export function bytesToBase64(bytes: Uint8Array): string {
  return notImplemented('bytesToBase64', bytes);
}

/** Throws SyntaxError on characters outside the base64 alphabet. */
export function base64ToBytes(text: string): Uint8Array {
  return notImplemented('base64ToBytes', text);
}
