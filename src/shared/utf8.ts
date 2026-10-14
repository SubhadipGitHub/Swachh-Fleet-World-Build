/** UTF-8 without TextEncoder/TextDecoder, which the pure layers' ES2022 lib does not declare (AD-2). */

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  const cps: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let c: number;
    let extra: number;
    if (b < 0x80) [c, extra] = [b, 0];
    else if (b >= 0xf0) [c, extra] = [b & 7, 3];
    else if (b >= 0xe0) [c, extra] = [b & 15, 2];
    else if (b >= 0xc0) [c, extra] = [b & 31, 1];
    else throw new RangeError(`Invalid UTF-8 lead byte at ${i}`);
    if (i + extra >= bytes.length) throw new RangeError('Truncated UTF-8 sequence');
    for (let k = 1; k <= extra; k++) c = (c << 6) | (bytes[i + k]! & 63);
    cps.push(c);
    i += extra + 1;
  }
  let out = '';
  for (let i = 0; i < cps.length; i += 4096) out += String.fromCodePoint(...cps.slice(i, i + 4096));
  return out;
}
