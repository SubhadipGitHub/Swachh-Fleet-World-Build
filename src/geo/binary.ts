import { utf8Decode, utf8Encode } from '../shared/utf8';

/** Little-endian binary writer with a growable buffer (snapshot files, AD-3). */
export class BinWriter {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  private pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  magic(tag: string): void {
    this.bytes(utf8Encode(tag));
  }
  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  /** Length-prefixed UTF-8 JSON. */
  json(value: unknown): void {
    const b = utf8Encode(JSON.stringify(value));
    this.u32(b.length);
    this.bytes(b);
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Little-endian reader. Reads past the end throw RangeError (from DataView), so truncated files fail loudly. */
export class BinReader {
  private readonly view: DataView;
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  expectMagic(tag: string): void {
    const got = utf8Decode(this.bytes(tag.length));
    if (got !== tag) throw new RangeError(`Bad magic: expected ${tag}, got ${got}`);
  }
  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new RangeError('Unexpected end of data');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  json(): unknown {
    return JSON.parse(utf8Decode(this.bytes(this.u32()))) as unknown;
  }
  /** Throws if bytes remain (a file with trailing garbage is as suspect as a truncated one). */
  end(): void {
    if (this.pos !== this.buf.length) throw new RangeError(`${this.buf.length - this.pos} unexpected trailing bytes`);
  }
}
