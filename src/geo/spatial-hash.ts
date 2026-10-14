/** Uniform-grid spatial hash of point objects by integer id, used for picking and proximity (AD-10). */
export class SpatialHash {
  private readonly cells = new Map<string, Set<number>>();
  private readonly points = new Map<number, { x: number; y: number; key: string }>();

  constructor(readonly cellSize: number) {
    if (!(cellSize > 0)) throw new RangeError('cellSize must be positive');
  }

  get size(): number {
    return this.points.size;
  }

  private cellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private keyOf(x: number, y: number): string {
    return this.cellKey(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
  }

  private addToCell(key: string, id: number): void {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    cell.add(id);
  }

  private removeFromCell(key: string, id: number): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(id);
    if (cell.size === 0) this.cells.delete(key);
  }

  /** Throws if the id is already present. */
  insert(id: number, x: number, y: number): void {
    if (this.points.has(id)) throw new Error(`SpatialHash: id ${id} already present`);
    const key = this.keyOf(x, y);
    this.points.set(id, { x, y, key });
    this.addToCell(key, id);
  }

  /** Throws if the id is absent. */
  move(id: number, x: number, y: number): void {
    const p = this.points.get(id);
    if (!p) throw new Error(`SpatialHash: id ${id} not present`);
    const key = this.keyOf(x, y);
    if (key !== p.key) {
      this.removeFromCell(p.key, id);
      this.addToCell(key, id);
    }
    this.points.set(id, { x, y, key });
  }

  /** Returns false if the id was absent. */
  remove(id: number): boolean {
    const p = this.points.get(id);
    if (!p) return false;
    this.removeFromCell(p.key, id);
    this.points.delete(id);
    return true;
  }

  private forCandidates(x: number, y: number, r: number, visit: (id: number, px: number, py: number) => void): void {
    const span = Math.ceil(r / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    // Visit cells overlapping the query box; fall back to a full scan when the box covers more cells than exist.
    if ((2 * span + 1) ** 2 > this.cells.size * 4) {
      for (const [id, p] of this.points) visit(id, p.x, p.y);
      return;
    }
    for (let gx = cx - span; gx <= cx + span; gx++) {
      for (let gy = cy - span; gy <= cy + span; gy++) {
        const cell = this.cells.get(this.cellKey(gx, gy));
        if (!cell) continue;
        for (const id of cell) {
          const p = this.points.get(id)!;
          visit(id, p.x, p.y);
        }
      }
    }
  }

  /** Ids within distance r (inclusive), in ascending id order. */
  queryRadius(x: number, y: number, r: number): number[] {
    const out: number[] = [];
    this.forCandidates(x, y, r, (id, px, py) => {
      if (Math.hypot(px - x, py - y) <= r) out.push(id);
    });
    return out.sort((a, b) => a - b);
  }

  /** The nearest id within maxR, the lowest id on ties, or null. */
  nearest(x: number, y: number, maxR: number): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    this.forCandidates(x, y, maxR, (id, px, py) => {
      const d = Math.hypot(px - x, py - y);
      if (d > maxR) return;
      if (d < bestD || (d === bestD && best !== null && id < best)) {
        best = id;
        bestD = d;
      }
    });
    return best;
  }
}
