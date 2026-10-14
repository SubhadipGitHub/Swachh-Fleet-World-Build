import { describe, expect, it } from 'vitest';
import { BinReader, BinWriter } from '../../../src/geo/binary';
import { MinHeap } from '../../../src/routing/heap';

// Low-level codecs behind the snapshot files and the shortest-path heap.

describe('BinWriter / BinReader', () => {
  it('round-trips every field type across buffer growth', () => {
    const w = new BinWriter();
    w.magic('TEST');
    for (let i = 0; i < 600; i++) {
      w.u8(i % 256);
      w.u16(i);
      w.i16(-i);
      w.u32(i * 70_000);
      w.f64(i / 3);
    }
    w.json({ ok: true, name: 'Kormangala' });
    const r = new BinReader(w.finish());
    r.expectMagic('TEST');
    for (let i = 0; i < 600; i++) {
      expect(r.u8()).toBe(i % 256);
      expect(r.u16()).toBe(i);
      expect(r.i16()).toBe(0 - i || 0);
      expect(r.u32()).toBe(i * 70_000);
      expect(r.f64()).toBe(i / 3);
    }
    expect(r.json()).toEqual({ ok: true, name: 'Kormangala' });
    expect(() => {
      r.end();
    }).not.toThrow();
  });

  it('rejects a wrong magic, trailing bytes and reads past the end', () => {
    const w = new BinWriter();
    w.magic('KFR1');
    w.u8(1);
    const bytes = w.finish();
    expect(() => {
      new BinReader(bytes).expectMagic('KFB1');
    }).toThrow(RangeError);
    const r = new BinReader(bytes);
    r.expectMagic('KFR1');
    expect(() => {
      r.end();
    }).toThrow(RangeError);
    r.u8();
    expect(() => r.u32()).toThrow(RangeError);
    expect(() => r.bytes(4)).toThrow(RangeError);
  });
});

describe('MinHeap', () => {
  it('pops in key order, ties by value, across growth', () => {
    const h = new MinHeap();
    const items = Array.from({ length: 300 }, (_, i) => [(i * 7919) % 101, i] as const);
    for (const [k, v] of items) h.push(k, v);
    const out: number[][] = [];
    while (h.size > 0) {
      const k = h.peekKey();
      out.push([k, h.pop()]);
    }
    const expected = [...items].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([k, v]) => [k, v]);
    expect(out).toEqual(expected);
    h.push(1, 1);
    h.clear();
    expect(h.size).toBe(0);
  });
});
