import { describe, expect, it } from 'vitest';
import { Fnv1a64, canonicalJson } from '../../../src/sim/events';

// The limb-based 64-bit FNV-1a against reference values computed independently (Python, arbitrary precision).

const hash = (s: string): string => {
  const h = new Fnv1a64();
  h.text(s);
  return h.hex();
};

describe('Fnv1a64', () => {
  it('matches the published FNV-1a 64 test vectors', () => {
    expect(hash('')).toBe('cbf29ce484222325');
    expect(hash('a')).toBe('af63dc4c8601ec8c');
    expect(hash('foobar')).toBe('85944171f73967e8');
  });

  it('hashes 2-, 3- and 4-byte UTF-8 characters correctly', () => {
    expect(hash('é')).toBe('0ac21707b7181e01');
    expect(hash('₹ 120')).toBe('25f9f04fea8d5fdd');
    expect(hash('\u{1d518}x')).toBe('7c35f8fa5c3c84a6');
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson(null)).toBe('null');
  });
});
