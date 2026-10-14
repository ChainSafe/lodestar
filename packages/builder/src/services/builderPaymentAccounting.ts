import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {RootHex, Slot} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {BidLedger, type BidLedgerRecord} from "./bidLedger.js";

export type BuilderPaymentSnapshot = {
  snapshotBlockRoot: RootHex;
  stateRoot: RootHex;
  slot: Slot;
  builderIndex: number;
  balanceGwei: number;
};

export type BuilderPaymentDecision = {
  bid: BidLedgerRecord;
  selectedBlockRoot: RootHex;
  outcome: "paid" | "cancelled";
};

export type BuilderBalanceContext = {
  snapshotBlockRoot: RootHex;
  currentSlot: Slot;
  maxSnapshotAgeSlots: number;
};

export class BuilderPaymentAccounting {
  private balanceSnapshot: BuilderPaymentSnapshot | null = null;
  private anchorInvalidated = false;
  private revision = 0;

  constructor(
    private readonly ledger: BidLedger,
    private readonly builderIndex: number
  ) {}

  getCheckpoint(): {revision: number; snapshot: BuilderPaymentSnapshot | null} {
    if (this.anchorInvalidated) {
      throw new LodestarError({code: "BUILDER_ACCOUNTING_ERROR_SETTLEMENT_ANCHOR_CHANGED"});
    }
    return {revision: this.revision, snapshot: this.balanceSnapshot === null ? null : {...this.balanceSnapshot}};
  }

  invalidateAnchor(): void {
    this.anchorInvalidated = true;
    this.revision++;
  }

  getAvailableBalanceGwei(context: BuilderBalanceContext): number | null {
    const {snapshotBlockRoot, currentSlot, maxSnapshotAgeSlots} = context;
    const snapshot = this.balanceSnapshot;
    if (
      snapshot === null ||
      this.anchorInvalidated ||
      snapshot.snapshotBlockRoot !== snapshotBlockRoot ||
      !Number.isSafeInteger(currentSlot) ||
      !Number.isSafeInteger(maxSnapshotAgeSlots) ||
      maxSnapshotAgeSlots < 0 ||
      currentSlot < snapshot.slot ||
      currentSlot - snapshot.slot > maxSnapshotAgeSlots
    ) {
      return null;
    }
    return Math.max(
      0,
      snapshot.balanceGwei - this.ledger.getUnsettledValueGwei(Math.floor(currentSlot / SLOTS_PER_EPOCH))
    );
  }

  /**
   * Requires canonical, finalized evidence for every decision against this exact snapshot.
   * The caller verifies payment or final cancellation; this method checks local identity and applies the batch atomically.
   * Unresolved obligations are omitted and remain reserved. Capture the revision before reading evidence.
   */
  applySnapshot(
    snapshot: BuilderPaymentSnapshot,
    decisions: readonly BuilderPaymentDecision[],
    expectedRevision: number,
    signal: AbortSignal
  ): void {
    signal.throwIfAborted();
    if (this.anchorInvalidated) {
      throw new LodestarError({code: "BUILDER_ACCOUNTING_ERROR_SETTLEMENT_ANCHOR_CHANGED"});
    }
    const previous = this.balanceSnapshot;
    if (
      this.revision !== expectedRevision ||
      (previous !== null &&
        (snapshot.slot < previous.slot ||
          (snapshot.slot === previous.slot &&
            (snapshot.snapshotBlockRoot !== previous.snapshotBlockRoot ||
              snapshot.stateRoot !== previous.stateRoot ||
              snapshot.balanceGwei !== previous.balanceGwei))))
    ) {
      throw new LodestarError({code: "BUILDER_ACCOUNTING_ERROR_STALE_SETTLEMENT"});
    }
    if (
      snapshot.builderIndex !== this.builderIndex ||
      !Number.isSafeInteger(snapshot.slot) ||
      snapshot.slot < 0 ||
      !Number.isSafeInteger(snapshot.balanceGwei) ||
      snapshot.balanceGwei < 0 ||
      decisions.length > SLOTS_PER_EPOCH ||
      new Set(decisions.map(({bid}) => bid.signedBidRoot)).size !== decisions.length
    ) {
      throw new LodestarError({code: "BUILDER_ACCOUNTING_ERROR_INCONSISTENT_SNAPSHOT"});
    }
    const records = decisions.map(({bid, selectedBlockRoot}) => {
      const current = this.ledger
        .getBidsForSlot(bid.slot)
        .find(
          (record) => record.parentBlockHash === bid.parentBlockHash && record.parentBlockRoot === bid.parentBlockRoot
        );
      if (
        !current ||
        bid.slot > snapshot.slot ||
        current.blockHash !== bid.blockHash ||
        current.signedBidRoot !== bid.signedBidRoot ||
        current.valueGwei !== bid.valueGwei ||
        !bid.wonBlockRoots.includes(selectedBlockRoot) ||
        current.wonBlockRoots.length !== bid.wonBlockRoots.length ||
        !current.wonBlockRoots.every((root) => bid.wonBlockRoots.includes(root))
      ) {
        throw new LodestarError({code: "BUILDER_ACCOUNTING_ERROR_LEDGER_CHANGED"});
      }
      return current;
    });
    this.ledger.getUnsettledValueGwei(Math.floor(snapshot.slot / SLOTS_PER_EPOCH));
    for (const [i, record] of records.entries()) {
      if (decisions[i].outcome === "paid") this.ledger.recordPaymentSettled(record);
      else this.ledger.recordPaymentCancelled(record);
    }
    this.balanceSnapshot = {...snapshot};
    this.revision++;
  }
}
