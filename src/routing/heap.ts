/**
 * Binary min-heap of (key, value) pairs in typed arrays, ordered by key then value, so equal keys pop in a fixed
 * order and searches stay deterministic (AD-7).
 */
export class MinHeap {
  private keys = new Float64Array(64);
  private values = new Int32Array(64);
  private n = 0;

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  private less(i: number, j: number): boolean {
    const a = this.keys[i]!;
    const b = this.keys[j]!;
    return a < b || (a === b && this.values[i]! < this.values[j]!);
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i]!;
    this.keys[i] = this.keys[j]!;
    this.keys[j] = k;
    const v = this.values[i]!;
    this.values[i] = this.values[j]!;
    this.values[j] = v;
  }

  push(key: number, value: number): void {
    if (this.n === this.keys.length) {
      const k = new Float64Array(this.n * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.n * 2);
      v.set(this.values);
      this.values = v;
    }
    let i = this.n++;
    this.keys[i] = key;
    this.values[i] = value;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** The smallest key without removing it. Call only when size > 0. */
  peekKey(): number {
    return this.keys[0]!;
  }

  /** Removes the smallest entry and returns its value. Call only when size > 0. */
  pop(): number {
    const top = this.values[0]!;
    this.n--;
    if (this.n > 0) {
      this.keys[0] = this.keys[this.n]!;
      this.values[0] = this.values[this.n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}
