import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, RootHex, Slot} from "@lodestar/types";

export type BidRecord = {
  slot: Slot;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
  valueGwei: number;
  /** Roots of blocks that committed to this bid */
  wonBlockRoots: RootHex[];
};

/**
 * A won bid is charged to the builder balance as a pending payment which is settled at the end of
 * the following epoch. Treat won bids as unsettled for this many epochs to not overbid.
 */
const UNSETTLED_EPOCHS = 2;

/** Keep records for this many slots, covers late wins and unsettled payments */
const KEEP_SLOTS = (UNSETTLED_EPOCHS + 1) * SLOTS_PER_EPOCH;

/**
 * Local record of submitted bids, wins and reveals. Enforces builder safety invariants the
 * protocol does not: one bid per tuple, one envelope per block root, and bids only for payloads
 * that were actually built.
 */
export class Ledger {
  private readonly bidsBySlot = new Map<Slot, Map<string, BidRecord>>();
  private readonly revealedBlockHashByBlockRoot = new Map<RootHex, RootHex>();

  hasSubmitted(slot: Slot, parentBlockHash: RootHex, parentBlockRoot: RootHex): boolean {
    return this.bidsBySlot.get(slot)?.has(tupleKey(parentBlockHash, parentBlockRoot)) ?? false;
  }

  recordBid(record: Omit<BidRecord, "wonBlockRoots">): void {
    let bySlot = this.bidsBySlot.get(record.slot);
    if (bySlot === undefined) {
      bySlot = new Map();
      this.bidsBySlot.set(record.slot, bySlot);
    }
    const key = tupleKey(record.parentBlockHash, record.parentBlockRoot);
    if (bySlot.has(key)) {
      throw Error(`Bid already submitted for slot=${record.slot} tuple=${key}`);
    }
    bySlot.set(key, {...record, wonBlockRoots: []});
  }

  /** Record that a block committed to one of our bids, returns the bid or null if unknown */
  recordWin(slot: Slot, blockHash: RootHex, blockRoot: RootHex): BidRecord | null {
    const record = this.getBidByBlockHash(slot, blockHash);
    if (record === null) {
      return null;
    }
    if (!record.wonBlockRoots.includes(blockRoot)) {
      record.wonBlockRoots.push(blockRoot);
    }
    return record;
  }

  /** An envelope must never be signed for two different payloads of the same block root */
  canReveal(blockRoot: RootHex, blockHash: RootHex): boolean {
    const revealed = this.revealedBlockHashByBlockRoot.get(blockRoot);
    return revealed === undefined || revealed === blockHash;
  }

  hasRevealed(blockRoot: RootHex): boolean {
    return this.revealedBlockHashByBlockRoot.has(blockRoot);
  }

  recordReveal(blockRoot: RootHex, blockHash: RootHex): void {
    if (!this.canReveal(blockRoot, blockHash)) {
      throw Error(`Envelope already signed for blockRoot=${blockRoot} with a different payload`);
    }
    this.revealedBlockHashByBlockRoot.set(blockRoot, blockHash);
  }

  /** Sum of won bid values that may still be charged to the builder balance */
  getUnsettledValueGwei(currentEpoch: Epoch): number {
    let total = 0;
    for (const [slot, bySlot] of this.bidsBySlot) {
      if (Math.floor(slot / SLOTS_PER_EPOCH) < currentEpoch - UNSETTLED_EPOCHS) {
        continue;
      }
      for (const record of bySlot.values()) {
        if (record.wonBlockRoots.length > 0) {
          total += record.valueGwei;
        }
      }
    }
    return total;
  }

  getBidsForSlot(slot: Slot): BidRecord[] {
    return Array.from(this.bidsBySlot.get(slot)?.values() ?? []);
  }

  prune(currentSlot: Slot): void {
    for (const [slot, bySlot] of this.bidsBySlot) {
      if (slot < currentSlot - KEEP_SLOTS) {
        for (const record of bySlot.values()) {
          for (const blockRoot of record.wonBlockRoots) {
            this.revealedBlockHashByBlockRoot.delete(blockRoot);
          }
        }
        this.bidsBySlot.delete(slot);
      }
    }
  }

  private getBidByBlockHash(slot: Slot, blockHash: RootHex): BidRecord | null {
    for (const record of this.bidsBySlot.get(slot)?.values() ?? []) {
      if (record.blockHash === blockHash) {
        return record;
      }
    }
    return null;
  }
}

function tupleKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}
