import type {Epoch, RootHex, Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {BID_HISTORY_SLOTS, MAX_BID_REVISIONS_PER_SLOT} from "./commitmentLimits.js";

export type SubmittedBid = {
  slot: Slot;
  parentBlockHash: RootHex;
  parentBlockRoot: RootHex;
  blockHash: RootHex;
  valueGwei: number;
  signedBidRoot: RootHex;
};

export type BidIdentity = Pick<SubmittedBid, "slot" | "parentBlockHash" | "parentBlockRoot" | "blockHash">;

export type BidLedgerRecord = SubmittedBid & {
  wonBlockRoots: RootHex[];
};

type RevealedPayload = {
  slot: Slot;
  blockHash: RootHex;
  envelopeRoot: RootHex;
  published: boolean;
};

type MutableBidLedgerRecord = SubmittedBid & {
  wonBlockRoots: Set<RootHex>;
  paymentSettled: boolean;
};

export enum BidLedgerErrorCode {
  INVALID_BID_VALUE = "BID_LEDGER_ERROR_INVALID_BID_VALUE",
  REVISION_LIMIT = "BID_LEDGER_ERROR_REVISION_LIMIT",
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
      code: BidLedgerErrorCode.DUPLICATE_BID | BidLedgerErrorCode.REVISION_LIMIT;
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

const KEEP_SLOTS = BID_HISTORY_SLOTS;

/** Retains signed revisions and tracks the separate first-gossip allowance for each parent tuple. */
export class BidLedger {
  private readonly recoveredLiabilityBySlot = new Map<Slot, number>();
  private readonly gossipBySlot = new Map<Slot, Set<string>>();
  private readonly bidsBySlot = new Map<Slot, Map<string, MutableBidLedgerRecord>>();
  private readonly revealedPayloadByBlockRoot = new Map<RootHex, RevealedPayload>();
  private pruneCutoffSlot = 0;

  hasSubmitted(slot: Slot, parentBlockHash: RootHex, parentBlockRoot: RootHex): boolean {
    return this.gossipBySlot.get(slot)?.has(tupleKey(parentBlockHash, parentBlockRoot)) ?? false;
  }

  getRevisionCount(slot: Slot): number {
    return this.bidsBySlot.get(slot)?.size ?? 0;
  }

  /** Preflight new offers before retaining their payload or signing. */
  assertCanRecordRevision(
    {slot, parentBlockHash, parentBlockRoot}: Pick<SubmittedBid, "slot" | "parentBlockHash" | "parentBlockRoot">,
    limit = MAX_BID_REVISIONS_PER_SLOT
  ): void {
    if (slot < this.pruneCutoffSlot) {
      throw new BidLedgerError({code: BidLedgerErrorCode.BID_TOO_OLD, slot, pruneCutoffSlot: this.pruneCutoffSlot});
    }
    // Bound all parent variants together, including uncertain network publications.
    if (this.getRevisionCount(slot) >= Math.min(limit, MAX_BID_REVISIONS_PER_SLOT)) {
      throw new BidLedgerError({code: BidLedgerErrorCode.REVISION_LIMIT, slot, parentBlockHash, parentBlockRoot});
    }
  }

  assertCanRecordBid({
    slot,
    parentBlockHash,
    parentBlockRoot,
  }: Pick<SubmittedBid, "slot" | "parentBlockHash" | "parentBlockRoot">): void {
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

  recordBid(bid: SubmittedBid): BidLedgerRecord {
    this.assertCanRecordBid(bid);
    const record = this.recordRevision(bid);
    let parents = this.gossipBySlot.get(bid.slot);
    if (!parents) {
      parents = new Set();
      this.gossipBySlot.set(bid.slot, parents);
    }
    parents.add(tupleKey(bid.parentBlockHash, bid.parentBlockRoot));
    return record;
  }

  /** Record before exposing a signed API response. Older revisions remain selectable. */
  recordRevision(bid: SubmittedBid): BidLedgerRecord {
    if (!Number.isSafeInteger(bid.valueGwei) || bid.valueGwei < 0) {
      throw new BidLedgerError(
        {code: BidLedgerErrorCode.INVALID_BID_VALUE, valueGwei: bid.valueGwei},
        `Invalid bid value valueGwei=${bid.valueGwei}`
      );
    }

    if (bid.slot < this.pruneCutoffSlot) {
      throw new BidLedgerError({
        code: BidLedgerErrorCode.BID_TOO_OLD,
        slot: bid.slot,
        pruneCutoffSlot: this.pruneCutoffSlot,
      });
    }
    const key = `${tupleKey(bid.parentBlockHash, bid.parentBlockRoot)}:${bid.signedBidRoot}`;
    let bidsForSlot = this.bidsBySlot.get(bid.slot);
    const previous = bidsForSlot?.get(key);
    if (previous) return toRecord(previous);
    this.assertCanRecordRevision(bid);
    if (bidsForSlot === undefined) {
      bidsForSlot = new Map();
      this.bidsBySlot.set(bid.slot, bidsForSlot);
    }
    const record = {...bid, wonBlockRoots: new Set<RootHex>(), paymentSettled: false};
    bidsForSlot.set(key, record);
    return toRecord(record);
  }

  recordWin(identity: BidIdentity & Pick<SubmittedBid, "signedBidRoot">, blockRoot: RootHex): BidLedgerRecord | null {
    const record = this.getBid(identity);
    if (record === null || record.blockHash !== identity.blockHash || record.signedBidRoot !== identity.signedBidRoot) {
      return null;
    }

    record.wonBlockRoots.add(blockRoot);
    return toRecord(record);
  }

  hasWon(identity: BidIdentity, blockRoot: RootHex): boolean {
    return this.getBids(identity).some((record) => record.wonBlockRoots.has(blockRoot));
  }

  /** Release a winning bid liability only after its payment is known to be reflected in Builder balance. */
  recordPaymentSettled(identity: BidIdentity): BidLedgerRecord | null {
    const records = this.getBids(identity).filter((record) => record.wonBlockRoots.size > 0);
    for (const record of records) record.paymentSettled = true;
    return records.length > 0 ? toRecord(records[0]) : null;
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
    for (const recoveredSlot of this.recoveredLiabilityBySlot.keys()) {
      if (recoveredSlot < slot) this.recoveredLiabilityBySlot.delete(recoveredSlot);
    }
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
    for (const [slot, bidsForSlot] of this.bidsBySlot) {
      let slotValue = this.recoveredLiabilityBySlot.get(slot) ?? 0;
      for (const record of bidsForSlot.values()) {
        if (record.wonBlockRoots.size === 0 || record.paymentSettled) {
          continue;
        }

        slotValue = Math.max(slotValue, record.valueGwei);
      }
      // Competing revisions/parents in one slot are mutually exclusive canonical payments.
      total += slotValue;
      if (!Number.isSafeInteger(total)) {
        throw new BidLedgerError({code: BidLedgerErrorCode.UNSETTLED_VALUE_OVERFLOW, currentEpoch});
      }
    }
    return total;
  }

  /** Selection events may have been missed while offline. Reserve the largest
   * recovered offer per slot until its payment would be reflected in balance. */
  reserveRecoveredSlot(slot: Slot, valueGwei: number): void {
    if (!Number.isSafeInteger(valueGwei) || valueGwei < 0) throw Error("INVALID_RECOVERED_LIABILITY");
    this.recoveredLiabilityBySlot.set(slot, Math.max(this.recoveredLiabilityBySlot.get(slot) ?? 0, valueGwei));
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
        if (!this.recoveredLiabilityBySlot.has(slot) && (record.wonBlockRoots.size === 0 || record.paymentSettled)) {
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
    for (const slot of this.gossipBySlot.keys()) {
      if (slot < this.pruneCutoffSlot && !this.bidsBySlot.has(slot)) this.gossipBySlot.delete(slot);
    }
    return removed;
  }

  private getBids(identity: BidIdentity): MutableBidLedgerRecord[] {
    return Array.from(this.bidsBySlot.get(identity.slot)?.values() ?? []).filter(
      (record) =>
        record.parentBlockHash === identity.parentBlockHash &&
        record.parentBlockRoot === identity.parentBlockRoot &&
        record.blockHash === identity.blockHash
    );
  }

  private getBid(identity: BidIdentity & {signedBidRoot?: RootHex}): MutableBidLedgerRecord | null {
    return (
      this.getBids(identity).find(
        (record) => identity.signedBidRoot === undefined || record.signedBidRoot === identity.signedBidRoot
      ) ?? null
    );
  }
}

function tupleKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}

function toRecord(record: MutableBidLedgerRecord): BidLedgerRecord {
  return {
    slot: record.slot,
    parentBlockHash: record.parentBlockHash,
    parentBlockRoot: record.parentBlockRoot,
    blockHash: record.blockHash,
    valueGwei: record.valueGwei,
    signedBidRoot: record.signedBidRoot,
    wonBlockRoots: Array.from(record.wonBlockRoots),
  };
}
