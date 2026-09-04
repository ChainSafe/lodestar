import {ForkPostGloas} from "@lodestar/params";
import {BlobsBundle, ExecutionPayload, Root, RootHex, Slot, gloas} from "@lodestar/types";

// NOTE: BuiltPayload will migrate to payloadSource.ts when the payload source lands; the store
// holds it here for now.
export type BuiltPayload = {
  sourceId: string;
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionRequests: gloas.ExecutionRequests;
  blobsBundle: BlobsBundle<ForkPostGloas>;
  /** Value of the payload to the fee recipient in wei, as reported by the execution client */
  executionPayloadValue: bigint;
};

export type StoredPayload = {
  slot: Slot;
  parentBlockRoot: Root;
  blockHash: RootHex;
  payload: BuiltPayload;
};

/** Keep payloads for this many slots after their target slot, late blocks may still commit to them */
const KEEP_SLOTS = 2;

export class PayloadStore {
  private readonly byBlockHash = new Map<RootHex, StoredPayload>();

  add(payload: StoredPayload): void {
    this.byBlockHash.set(payload.blockHash, payload);
  }

  get(blockHash: RootHex): StoredPayload | null {
    return this.byBlockHash.get(blockHash) ?? null;
  }

  has(blockHash: RootHex): boolean {
    return this.byBlockHash.has(blockHash);
  }

  prune(currentSlot: Slot): void {
    for (const [blockHash, {slot}] of this.byBlockHash) {
      if (slot + KEEP_SLOTS < currentSlot) {
        this.byBlockHash.delete(blockHash);
      }
    }
  }

  get size(): number {
    return this.byBlockHash.size;
  }
}
