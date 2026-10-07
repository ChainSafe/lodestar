import {BLSPubkey, Epoch} from "@lodestar/types";
import {DistanceEntry, IDistanceStore} from "./interface.js";

/**
 * Buffers the span writes of a single pubkey in memory, reads fall through to the wrapped store. Lets a batch
 * of attestations be checked against each other without mutating the db, nothing is written until `commit`.
 *
 * The buffer holds one entry per source epoch the batch touches, bounded by its epoch range plus the min-span
 * lookback as span updates stop as soon as a recorded distance is already tighter.
 */
export class BufferedDistanceStore implements IDistanceStore {
  minSpan: BufferedSpanDistance;
  maxSpan: BufferedSpanDistance;

  constructor(store: IDistanceStore, pubkey: BLSPubkey) {
    this.minSpan = new BufferedSpanDistance(store.minSpan, pubkey);
    this.maxSpan = new BufferedSpanDistance(store.maxSpan, pubkey);
  }

  async commit(): Promise<void> {
    await this.minSpan.commit();
    await this.maxSpan.commit();
  }
}

class BufferedSpanDistance {
  private readonly buffer = new Map<Epoch, Epoch>();

  constructor(
    private readonly store: IDistanceStore["minSpan"],
    private readonly pubkey: BLSPubkey
  ) {}

  async get(_pubkey: BLSPubkey, epoch: Epoch): Promise<Epoch | null> {
    return this.buffer.get(epoch) ?? this.store.get(this.pubkey, epoch);
  }

  async setBatch(_pubkey: BLSPubkey, values: DistanceEntry[]): Promise<void> {
    for (const {source, distance} of values) {
      this.buffer.set(source, distance);
    }
  }

  async commit(): Promise<void> {
    const values = Array.from(this.buffer, ([source, distance]) => ({source, distance}));
    this.buffer.clear();
    await this.store.setBatch(this.pubkey, values);
  }
}
