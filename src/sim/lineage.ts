import type { SimTime } from './clock';
import type { StopTarget } from './events';

/** A collected amount of waste followed from its bin or street to KCDC or the landfill (M2-8). */
export interface Batch {
  readonly id: number;
  readonly origin: StopTarget;
  readonly kg: number;
  readonly collectedAt: SimTime;
  readonly collectedBy: number;
  readonly transferredAt: SimTime | null;
  readonly transferPointId: number | null;
  readonly loadedAt: SimTime | null;
  readonly processedAt: SimTime | null;
  readonly site: 'KCDC' | 'Landfill' | null;
}

interface MutableBatch {
  id: number;
  /** The id of the collection this batch (or split part) came from. */
  root: number;
  origin: StopTarget;
  kg: number;
  collectedAt: SimTime;
  collectedBy: number;
  transferredAt: SimTime | null;
  transferPointId: number | null;
  loadedAt: SimTime | null;
  processedAt: SimTime | null;
  site: 'KCDC' | 'Landfill' | null;
}

const originKey = (o: StopTarget): string => `${o.type}:${o.id}`;
const progress = (b: MutableBatch): number => (b.processedAt !== null ? 3 : b.loadedAt !== null ? 2 : b.transferredAt !== null ? 1 : 0);
const view = (b: MutableBatch): Batch => ({
  id: b.id,
  origin: b.origin,
  kg: b.kg,
  collectedAt: b.collectedAt,
  collectedBy: b.collectedBy,
  transferredAt: b.transferredAt,
  transferPointId: b.transferPointId,
  loadedAt: b.loadedAt,
  processedAt: b.processedAt,
  site: b.site,
});

/**
 * Batch bookkeeping (M2-8). Tipping moves a vehicle's batches to the transfer point's FIFO queue. Loading takes from
 * the front of the queue, splitting the last batch if needed: the loaded part gets a new id and the rest keeps the
 * old one. Unloading stamps the vehicle's batches processed. Ids increase from 1.
 */
export class Lineage {
  private nextId = 1;
  private readonly batches = new Map<number, MutableBatch>();
  private readonly onVehicle = new Map<number, number[]>();
  private readonly atTp = new Map<number, number[]>();
  private readonly byOrigin = new Map<string, number[]>();

  private add(b: MutableBatch): void {
    this.batches.set(b.id, b);
    const key = originKey(b.origin);
    const list = this.byOrigin.get(key);
    if (list) list.push(b.id);
    else this.byOrigin.set(key, [b.id]);
  }

  private push(map: Map<number, number[]>, key: number, ids: readonly number[]): void {
    const list = map.get(key);
    if (list) list.push(...ids);
    else map.set(key, [...ids]);
  }

  collect(origin: StopTarget, kg: number, t: SimTime, vehicleId: number): Batch {
    const id = this.nextId++;
    const b: MutableBatch = { id, root: id, origin, kg, collectedAt: t, collectedBy: vehicleId, transferredAt: null, transferPointId: null, loadedAt: null, processedAt: null, site: null };
    this.add(b);
    this.push(this.onVehicle, vehicleId, [id]);
    return view(b);
  }

  /** Moves everything `vehicleId` carries to the back of the transfer point's queue. */
  tip(vehicleId: number, transferPointId: number, t: SimTime): void {
    const ids = this.onVehicle.get(vehicleId) ?? [];
    for (const id of ids) {
      const b = this.batches.get(id)!;
      b.transferredAt = t;
      b.transferPointId = transferPointId;
    }
    this.push(this.atTp, transferPointId, ids);
    this.onVehicle.delete(vehicleId);
  }

  /** Loads up to `kg` from the front of the queue onto `vehicleId`. Returns the kg actually loaded. */
  load(transferPointId: number, kg: number, t: SimTime, vehicleId: number): number {
    const queue = this.atTp.get(transferPointId) ?? [];
    let left = kg;
    const loaded: number[] = [];
    while (left > 1e-9 && queue.length > 0) {
      const b = this.batches.get(queue[0]!)!;
      if (b.kg <= left + 1e-9) {
        queue.shift();
        b.loadedAt = t;
        left -= b.kg;
        loaded.push(b.id);
      } else {
        const part: MutableBatch = { ...b, id: this.nextId++, kg: left, loadedAt: t };
        b.kg -= left;
        this.add(part);
        loaded.push(part.id);
        left = 0;
      }
    }
    if (queue.length === 0) this.atTp.delete(transferPointId);
    this.push(this.onVehicle, vehicleId, loaded);
    return kg - left;
  }

  unload(vehicleId: number, site: 'KCDC' | 'Landfill', t: SimTime): void {
    for (const id of this.onVehicle.get(vehicleId) ?? []) {
      const b = this.batches.get(id)!;
      b.processedAt = t;
      b.site = site;
    }
    this.onVehicle.delete(vehicleId);
  }

  carriedBy(vehicleId: number): Batch[] {
    return (this.onVehicle.get(vehicleId) ?? []).map((id) => view(this.batches.get(id)!));
  }

  /** The queue at a transfer point, oldest first. */
  waitingAt(transferPointId: number): Batch[] {
    return (this.atTp.get(transferPointId) ?? []).map((id) => view(this.batches.get(id)!));
  }

  /** The most recent collection from `origin`; of its parts after a split, the one furthest along. */
  latestFor(origin: StopTarget): Batch | null {
    const ids = this.byOrigin.get(originKey(origin));
    if (!ids || ids.length === 0) return null;
    let best: MutableBatch | null = null;
    for (const id of ids) {
      const b = this.batches.get(id)!;
      if (!best || b.collectedAt > best.collectedAt || (b.collectedAt === best.collectedAt && b.root === best.root && progress(b) > progress(best))) best = b;
      else if (b.collectedAt === best.collectedAt && b.root !== best.root && b.root > best.root) best = b;
    }
    return best ? view(best) : null;
  }

  /** Forgets processed batches collected before `t` (memory bound). */
  pruneBefore(t: SimTime): void {
    for (const [key, ids] of this.byOrigin) {
      const keep = ids.filter((id) => {
        const b = this.batches.get(id)!;
        if (b.processedAt !== null && b.collectedAt < t) {
          this.batches.delete(id);
          return false;
        }
        return true;
      });
      if (keep.length === 0) this.byOrigin.delete(key);
      else this.byOrigin.set(key, keep);
    }
  }
}
