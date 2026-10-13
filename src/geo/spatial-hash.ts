import { notImplemented } from '../shared/not-implemented';

/** Uniform-grid spatial hash of point objects by integer id, used for picking and proximity (AD-10). */
export class SpatialHash {
  constructor(readonly cellSize: number) {
    if (!(cellSize > 0)) throw new RangeError('cellSize must be positive');
  }

  get size(): number {
    return notImplemented('SpatialHash.size');
  }

  /** Throws if the id is already present. */
  insert(id: number, x: number, y: number): void {
    notImplemented('SpatialHash.insert', id, x, y);
  }

  /** Throws if the id is absent. */
  move(id: number, x: number, y: number): void {
    notImplemented('SpatialHash.move', id, x, y);
  }

  /** Returns false if the id was absent. */
  remove(id: number): boolean {
    return notImplemented('SpatialHash.remove', id);
  }

  /** Ids within distance r (inclusive), in ascending id order. */
  queryRadius(x: number, y: number, r: number): number[] {
    return notImplemented('SpatialHash.queryRadius', x, y, r);
  }

  /** The nearest id within maxR, the lowest id on ties, or null. */
  nearest(x: number, y: number, maxR: number): number | null {
    return notImplemented('SpatialHash.nearest', x, y, maxR);
  }
}
