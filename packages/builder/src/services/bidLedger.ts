import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {Epoch, RootHex, Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";

export type SubmittedBid = {
  slot: Slot;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
  valueGwei: number;
};

export type BidIdentity = Pick<SubmittedBid, "slot" | "parentBlockHash" | "parentBlockRoot" | "blockHash">;

export type BidLedgerRecord = SubmittedBid & {
  wonBlockRoots: RootHex[];
};

type RevealedPayload = {
  slot: Slot;
  blockHash: RootHex;
};

type MutableBidLedgerRecord = SubmittedBid & {
  wonBlockRoots: Set<RootHex>;
};

export enum BidLedgerErrorCode {
  INVALID_BID_VALUE = "BID_LEDGER_ERROR_INVALID_BID_VALUE",
  DUPLICATE_BID = "BID_LEDGER_ERROR_DUPLICATE_BID",
  REVEAL_CONFLICT = "BID_LEDGER_ERROR_REVEAL_CONFLICT",
  UNSETTLED_VALUE_OVERFLOW = "BID_LEDGER_ERROR_UNSETTLED_VALUE_OVERFLOW",
}

export type BidLedgerErrorType =
  | {
      code: BidLedgerErrorCode.INVALID_BID_VALUE;
      valueGwei: number;
    }
  | {
      code: BidLedgerErrorCode.DUPLICATE_BID;
      slot: Slot;
      parentBlockHash: RootHex;
      parentBlockRoot: RootHex;
    }
  | {
      code: BidLedgerErrorCode.REVEAL_CONFLICT;
      blockRoot: RootHex;
      blockHash: RootHex;
      revealedBlockHash: RootHex;
    }
  | {
      code: BidLedgerErrorCode.UNSETTLED_VALUE_OVERFLOW;
      currentEpoch: Epoch;
    };

export class BidLedgerError extends LodestarError<BidLedgerErrorType> {}

const UNSETTLED_EPOCHS = 2;
const KEEP_SLOTS = (UNSETTLED_EPOCHS + 1) * SLOTS_PER_EPOCH;

/** Tracks one-shot bids and reveal obligations without owning signing, publication, or persistence. */
export class BidLedger {
  private readonly bidsBySlot = new Map<Slot, Map<string, MutableBidLedgerRecord>>();
  private readonly revealedPayloadByBlockRoot = new Map<RootHex, RevealedPayload>();

  hasSubmitted(slot: Slot, parentBlockHash: RootHex, parentBlockRoot: RootHex): boolean {
    return this.bidsBySlot.get(slot)?.has(tupleKey(parentBlockHash, parentBlockRoot)) ?? false;
  }

  recordBid(bid: SubmittedBid): BidLedgerRecord {
    if (!Number.isSafeInteger(bid.valueGwei) || bid.valueGwei < 0) {
      throw new BidLedgerError(
        {code: BidLedgerErrorCode.INVALID_BID_VALUE, valueGwei: bid.valueGwei},
        `Invalid bid value valueGwei=${bid.valueGwei}`
      );
    }

    let bidsForSlot = this.bidsBySlot.get(bid.slot);
    if (bidsForSlot === undefined) {
      bidsForSlot = new Map();
      this.bidsBySlot.set(bid.slot, bidsForSlot);
    }

    const key = tupleKey(bid.parentBlockHash, bid.parentBlockRoot);
    if (bidsForSlot.has(key)) {
      throw new BidLedgerError(
        {
          code: BidLedgerErrorCode.DUPLICATE_BID,
          slot: bid.slot,
          parentBlockHash: bid.parentBlockHash,
          parentBlockRoot: bid.parentBlockRoot,
        },
        `Bid already recorded slot=${bid.slot} parentBlockHash=${bid.parentBlockHash} parentBlockRoot=${bid.parentBlockRoot}`
      );
    }

    const record = {...bid, wonBlockRoots: new Set<RootHex>()};
    bidsForSlot.set(key, record);
    return toRecord(record);
  }

  recordWin(identity: BidIdentity, blockRoot: RootHex): BidLedgerRecord | null {
    const record = this.getBid(identity.slot, identity.parentBlockHash, identity.parentBlockRoot);
    if (record === null || record.blockHash !== identity.blockHash) {
      return null;
    }

    record.wonBlockRoots.add(blockRoot);
    return toRecord(record);
  }

  canReveal(blockRoot: RootHex, blockHash: RootHex): boolean {
    const revealedPayload = this.revealedPayloadByBlockRoot.get(blockRoot);
    return revealedPayload === undefined || revealedPayload.blockHash === blockHash;
  }

  hasRevealed(blockRoot: RootHex): boolean {
    return this.revealedPayloadByBlockRoot.has(blockRoot);
  }

  recordReveal(slot: Slot, blockRoot: RootHex, blockHash: RootHex): void {
    const revealedPayload = this.revealedPayloadByBlockRoot.get(blockRoot);
    if (revealedPayload !== undefined) {
      if (revealedPayload.blockHash !== blockHash) {
        throw new BidLedgerError(
          {
            code: BidLedgerErrorCode.REVEAL_CONFLICT,
            blockRoot,
            blockHash,
            revealedBlockHash: revealedPayload.blockHash,
          },
          `Envelope already recorded blockRoot=${blockRoot} blockHash=${revealedPayload.blockHash}`
        );
      }
      return;
    }

    this.revealedPayloadByBlockRoot.set(blockRoot, {slot, blockHash});
  }

  getUnsettledValueGwei(currentEpoch: Epoch): number {
    let total = 0;
    for (const [slot, bidsForSlot] of this.bidsBySlot) {
      if (Math.floor(slot / SLOTS_PER_EPOCH) < currentEpoch - UNSETTLED_EPOCHS) {
        continue;
      }

      for (const record of bidsForSlot.values()) {
        if (record.wonBlockRoots.size === 0) {
          continue;
        }

        total += record.valueGwei;
        if (!Number.isSafeInteger(total)) {
          throw new BidLedgerError(
            {code: BidLedgerErrorCode.UNSETTLED_VALUE_OVERFLOW, currentEpoch},
            `Unsettled bid value exceeds the safe integer range currentEpoch=${currentEpoch}`
          );
        }
      }
    }
    return total;
  }

  getBidsForSlot(slot: Slot): BidLedgerRecord[] {
    return Array.from(this.bidsBySlot.get(slot)?.values() ?? [], toRecord);
  }

  prune(currentSlot: Slot): number {
    let removed = 0;
    for (const [slot, bidsForSlot] of this.bidsBySlot) {
      if (slot >= currentSlot - KEEP_SLOTS) {
        continue;
      }

      removed += bidsForSlot.size;
      this.bidsBySlot.delete(slot);
    }

    for (const [blockRoot, revealedPayload] of this.revealedPayloadByBlockRoot) {
      if (revealedPayload.slot < currentSlot - KEEP_SLOTS) {
        this.revealedPayloadByBlockRoot.delete(blockRoot);
      }
    }
    return removed;
  }

  private getBid(slot: Slot, parentBlockHash: RootHex, parentBlockRoot: RootHex): MutableBidLedgerRecord | null {
    return this.bidsBySlot.get(slot)?.get(tupleKey(parentBlockHash, parentBlockRoot)) ?? null;
  }
}

function tupleKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}

function toRecord(record: MutableBidLedgerRecord): BidLedgerRecord {
  return {...record, wonBlockRoots: Array.from(record.wonBlockRoots)};
}
