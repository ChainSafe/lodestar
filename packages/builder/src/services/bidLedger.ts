import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {Epoch, RootHex, Slot, gloas} from "@lodestar/types";
import {LodestarError, toRootHex} from "@lodestar/utils";

export type SubmittedBid = {
  signedBid: gloas.SignedExecutionPayloadBid;
  signedBidRoot: RootHex;
};

export type BidIdentity = {
  slot: Slot;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
};

export type BidLedgerRecord = SubmittedBid &
  BidIdentity & {
    wonBlockRoots: RootHex[];
  };

type RevealedPayload = {
  slot: Slot;
  blockHash: RootHex;
  envelopeRoot: RootHex;
  published: boolean;
};

type MutableBidLedgerRecord = SubmittedBid & {
  /** Derived from the signed bid when it is recorded */
  identity: BidIdentity;
  /** Value of the signed bid when it is recorded, later changes to the signed bid do not affect the liability */
  valueGwei: number;
  wonBlockRoots: Set<RootHex>;
  paymentSettled: boolean;
};

export enum BidLedgerErrorCode {
  INVALID_BID_VALUE = "BID_LEDGER_ERROR_INVALID_BID_VALUE",
  DUPLICATE_BID = "BID_LEDGER_ERROR_DUPLICATE_BID",
  BID_TOO_OLD = "BID_LEDGER_ERROR_BID_TOO_OLD",
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
      code: BidLedgerErrorCode.BID_TOO_OLD;
      slot: Slot;
      pruneCutoffSlot: Slot;
    }
  | {
      code: BidLedgerErrorCode.REVEAL_CONFLICT;
      blockRoot: RootHex;
      blockHash: RootHex;
      revealedBlockHash: RootHex;
      envelopeRoot: RootHex;
      revealedEnvelopeRoot: RootHex;
    }
  | {
      code: BidLedgerErrorCode.UNSETTLED_VALUE_OVERFLOW;
      currentEpoch: Epoch;
    };

export class BidLedgerError extends LodestarError<BidLedgerErrorType> {}

const RECORD_RETENTION_EPOCHS = 3;
const KEEP_SLOTS = RECORD_RETENTION_EPOCHS * SLOTS_PER_EPOCH;

/** Tracks at most one bid per (slot, parentBlockHash, parentBlockRoot) and its reveal obligations. */
export class BidLedger {
  private readonly bidsBySlot = new Map<Slot, Map<string, MutableBidLedgerRecord>>();
  private readonly revealedPayloadByBlockRoot = new Map<RootHex, RevealedPayload>();
  private pruneCutoffSlot = 0;

  hasSubmitted(slot: Slot, parentBlockHash: RootHex, parentBlockRoot: RootHex): boolean {
    return this.bidsBySlot.get(slot)?.has(tupleKey(parentBlockHash, parentBlockRoot)) ?? false;
  }

  assertCanRecordBid({
    slot,
    parentBlockHash,
    parentBlockRoot,
  }: Pick<BidIdentity, "slot" | "parentBlockHash" | "parentBlockRoot">): void {
    if (slot < this.pruneCutoffSlot) {
      throw new BidLedgerError({code: BidLedgerErrorCode.BID_TOO_OLD, slot, pruneCutoffSlot: this.pruneCutoffSlot});
    }
    if (this.hasSubmitted(slot, parentBlockHash, parentBlockRoot)) {
      throw new BidLedgerError(
        {code: BidLedgerErrorCode.DUPLICATE_BID, slot, parentBlockHash, parentBlockRoot},
        `Bid already recorded slot=${slot} parentBlockHash=${parentBlockHash} parentBlockRoot=${parentBlockRoot}`
      );
    }
  }

  recordBid({signedBid, signedBidRoot}: SubmittedBid): BidLedgerRecord {
    const bid = signedBid.message;
    const valueGwei = bid.value;
    if (!Number.isSafeInteger(valueGwei) || valueGwei < 0) {
      throw new BidLedgerError(
        {code: BidLedgerErrorCode.INVALID_BID_VALUE, valueGwei},
        `Invalid bid value valueGwei=${valueGwei}`
      );
    }

    const identity: BidIdentity = {
      slot: bid.slot,
      parentBlockHash: toRootHex(bid.parentBlockHash),
      parentBlockRoot: toRootHex(bid.parentBlockRoot),
      blockHash: toRootHex(bid.blockHash),
    };
    this.assertCanRecordBid(identity);
    let bidsForSlot = this.bidsBySlot.get(identity.slot);
    if (bidsForSlot === undefined) {
      bidsForSlot = new Map();
      this.bidsBySlot.set(identity.slot, bidsForSlot);
    }

    const key = tupleKey(identity.parentBlockHash, identity.parentBlockRoot);
    const record = {
      signedBid,
      signedBidRoot,
      identity,
      valueGwei,
      wonBlockRoots: new Set<RootHex>(),
      paymentSettled: false,
    };
    bidsForSlot.set(key, record);
    return toRecord(record);
  }

  recordWin(identity: BidIdentity & Pick<SubmittedBid, "signedBidRoot">, blockRoot: RootHex): BidLedgerRecord | null {
    const record = this.getBid(identity.slot, identity.parentBlockHash, identity.parentBlockRoot);
    if (
      record === null ||
      record.identity.blockHash !== identity.blockHash ||
      record.signedBidRoot !== identity.signedBidRoot
    ) {
      return null;
    }

    record.wonBlockRoots.add(blockRoot);
    return toRecord(record);
  }

  hasWon(identity: BidIdentity, blockRoot: RootHex): boolean {
    const record = this.getBid(identity.slot, identity.parentBlockHash, identity.parentBlockRoot);
    return record !== null && record.identity.blockHash === identity.blockHash && record.wonBlockRoots.has(blockRoot);
  }

  /** Release a winning bid liability only after its payment is known to be reflected in Builder balance. */
  recordPaymentSettled(identity: BidIdentity): BidLedgerRecord | null {
    const record = this.getBid(identity.slot, identity.parentBlockHash, identity.parentBlockRoot);
    if (record === null || record.identity.blockHash !== identity.blockHash || record.wonBlockRoots.size === 0) {
      return null;
    }

    record.paymentSettled = true;
    return toRecord(record);
  }

  canReveal(blockRoot: RootHex, blockHash: RootHex, envelopeRoot: RootHex): boolean {
    const revealedPayload = this.revealedPayloadByBlockRoot.get(blockRoot);
    return (
      revealedPayload === undefined ||
      (revealedPayload.blockHash === blockHash && revealedPayload.envelopeRoot === envelopeRoot)
    );
  }

  hasRevealed(blockRoot: RootHex): boolean {
    return this.revealedPayloadByBlockRoot.has(blockRoot);
  }

  hasPublishedReveal(blockRoot: RootHex): boolean {
    return this.revealedPayloadByBlockRoot.get(blockRoot)?.published ?? false;
  }

  recordReveal(slot: Slot, blockRoot: RootHex, blockHash: RootHex, envelopeRoot: RootHex): void {
    const revealedPayload = this.revealedPayloadByBlockRoot.get(blockRoot);
    if (revealedPayload !== undefined) {
      if (revealedPayload.blockHash !== blockHash || revealedPayload.envelopeRoot !== envelopeRoot) {
        throw new BidLedgerError(
          {
            code: BidLedgerErrorCode.REVEAL_CONFLICT,
            blockRoot,
            blockHash,
            revealedBlockHash: revealedPayload.blockHash,
            envelopeRoot,
            revealedEnvelopeRoot: revealedPayload.envelopeRoot,
          },
          `Different envelope already recorded blockRoot=${blockRoot} envelopeRoot=${revealedPayload.envelopeRoot}`
        );
      }
      return;
    }

    this.revealedPayloadByBlockRoot.set(blockRoot, {slot, blockHash, envelopeRoot, published: false});
  }

  recordRevealPublished(slot: Slot, blockRoot: RootHex, blockHash: RootHex, envelopeRoot: RootHex): void {
    this.recordReveal(slot, blockRoot, blockHash, envelopeRoot);
    const revealedPayload = this.revealedPayloadByBlockRoot.get(blockRoot);
    if (revealedPayload !== undefined) {
      revealedPayload.published = true;
    }
  }

  /** Marks won bids before the given slot as settled, by then their payment is reflected in the builder balance. */
  settlePaymentsBefore(slot: Slot): void {
    for (const [bidSlot, bidsForSlot] of this.bidsBySlot) {
      if (bidSlot >= slot) {
        continue;
      }

      for (const record of bidsForSlot.values()) {
        if (record.wonBlockRoots.size > 0) {
          record.paymentSettled = true;
        }
      }
    }
  }

  getUnsettledValueGwei(currentEpoch: Epoch): number {
    let total = 0;
    for (const bidsForSlot of this.bidsBySlot.values()) {
      for (const record of bidsForSlot.values()) {
        if (record.wonBlockRoots.size === 0 || record.paymentSettled) {
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

  /** Returns the signed bid recorded for the slot and parent, null if no bid was recorded for it */
  getSignedBid(slot: Slot, parentBlockHash: RootHex, parentBlockRoot: RootHex): gloas.SignedExecutionPayloadBid | null {
    return this.getBid(slot, parentBlockHash, parentBlockRoot)?.signedBid ?? null;
  }

  getBidsForSlot(slot: Slot): BidLedgerRecord[] {
    return Array.from(this.bidsBySlot.get(slot)?.values() ?? [], toRecord);
  }

  prune(currentSlot: Slot): number {
    // Pruning must not make an expired slot eligible for another submission.
    this.pruneCutoffSlot = Math.max(this.pruneCutoffSlot, currentSlot - KEEP_SLOTS);
    let removed = 0;
    for (const [slot, bidsForSlot] of this.bidsBySlot) {
      if (slot >= this.pruneCutoffSlot) {
        continue;
      }

      for (const [key, record] of bidsForSlot) {
        if (record.wonBlockRoots.size === 0 || record.paymentSettled) {
          bidsForSlot.delete(key);
          removed++;
        }
      }
      if (bidsForSlot.size === 0) {
        this.bidsBySlot.delete(slot);
      }
    }

    for (const [blockRoot, revealedPayload] of this.revealedPayloadByBlockRoot) {
      if (revealedPayload.slot < this.pruneCutoffSlot) {
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
  return {
    ...record.identity,
    signedBid: record.signedBid,
    signedBidRoot: record.signedBidRoot,
    wonBlockRoots: Array.from(record.wonBlockRoots),
  };
}
