import {Root, RootHex, Slot} from "@lodestar/types";
import {BuiltPayload} from "./payloadSource.js";

export type StoredPayload = {
  slot: Slot;
  /** Root of the beacon block the payload builds on, the envelope's parentBeaconBlockRoot */
  parentBlockRoot: Root;
  blockHash: RootHex;
  payload: BuiltPayload;
};

/** Keep payloads for this many slots after their target slot, late blocks may still commit to them */
const KEEP_SLOTS = 2;

/**
 * Payload material the builder has bid on, keyed by block hash. A bid must never be signed for a
 * payload that is not in this store since it could not be revealed.
 */
export class PayloadStore {
  private readonly byBlockHash = new Map<RootHex, StoredPayload>();

  add(stored: StoredPayload): void {
    this.byBlockHash.set(stored.blockHash, stored);
  }

  get(blockHash: RootHex): StoredPayload | null {
    return this.byBlockHash.get(blockHash) ?? null;
  }

  has(blockHash: RootHex): boolean {
    return this.byBlockHash.has(blockHash);
  }

  prune(currentSlot: Slot): void {
    for (const [blockHash, {slot}] of this.byBlockHash) {
      if (slot < currentSlot - KEEP_SLOTS) {
        this.byBlockHash.delete(blockHash);
      }
    }
  }

  get size(): number {
    return this.byBlockHash.size;
  }
}
