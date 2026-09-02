import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {RootHex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BidLedger, BidLedgerError, BidLedgerErrorCode, type SubmittedBid} from "../../../src/services/bidLedger.js";

describe("BidLedger", () => {
  it("records one bid per slot and parent tuple", () => {
    const ledger = new BidLedger();
    const bid = submittedBid();

    expect(ledger.hasSubmitted(bid.slot, bid.parentBlockHash, bid.parentBlockRoot)).toBe(false);
    expect(ledger.recordBid(bid)).toEqual({...bid, wonBlockRoots: []});
    expect(ledger.hasSubmitted(bid.slot, bid.parentBlockHash, bid.parentBlockRoot)).toBe(true);
    expect(ledger.hasSubmitted(bid.slot + 1, bid.parentBlockHash, bid.parentBlockRoot)).toBe(false);
  });

  it("rejects a second bid for the same tuple with a structured error", () => {
    const ledger = new BidLedger();
    const bid = submittedBid();
    ledger.recordBid(bid);

    const error = getBidLedgerError(() => ledger.recordBid({...bid, blockHash: root(5)}));

    expect(error.type).toEqual({
      code: BidLedgerErrorCode.DUPLICATE_BID,
      slot: bid.slot,
      parentBlockHash: bid.parentBlockHash,
      parentBlockRoot: bid.parentBlockRoot,
    });
    expect(ledger.getBidsForSlot(bid.slot)).toEqual([{...bid, wonBlockRoots: []}]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid bid value %s",
    (valueGwei) => {
      const ledger = new BidLedger();
      const error = getBidLedgerError(() => ledger.recordBid(submittedBid({valueGwei})));

      expect(error.type).toEqual({code: BidLedgerErrorCode.INVALID_BID_VALUE, valueGwei});
      expect(ledger.getBidsForSlot(1)).toEqual([]);
    }
  );

  it("records a win only for the exact local bid identity", () => {
    const ledger = new BidLedger();
    const bid = submittedBid();
    const blockRoot = root(6);
    ledger.recordBid(bid);

    expect(ledger.recordWin({...bid, blockHash: root(7)}, blockRoot)).toBeNull();
    expect(ledger.recordWin(bid, blockRoot)).toEqual({...bid, wonBlockRoots: [blockRoot]});
    expect(ledger.recordWin(bid, blockRoot)).toEqual({...bid, wonBlockRoots: [blockRoot]});
  });

  it("distinguishes bids with the same payload hash on different parent roots", () => {
    const ledger = new BidLedger();
    const first = submittedBid();
    const second = submittedBid({parentBlockRoot: root(8)});
    ledger.recordBid(first);
    ledger.recordBid(second);

    const secondWin = ledger.recordWin(second, root(9));

    expect(secondWin).toEqual({...second, wonBlockRoots: [root(9)]});
    expect(ledger.getBidsForSlot(first.slot)).toEqual([
      {...first, wonBlockRoots: []},
      {...second, wonBlockRoots: [root(9)]},
    ]);
  });

  it("records one payload per beacon block root", () => {
    const ledger = new BidLedger();
    const blockRoot = root(6);
    const blockHash = root(4);

    expect(ledger.canReveal(blockRoot, blockHash)).toBe(true);
    ledger.recordReveal(1, blockRoot, blockHash);
    ledger.recordReveal(1, blockRoot, blockHash);

    expect(ledger.hasRevealed(blockRoot)).toBe(true);
    expect(ledger.canReveal(blockRoot, blockHash)).toBe(true);
    expect(ledger.canReveal(blockRoot, root(7))).toBe(false);

    const error = getBidLedgerError(() => ledger.recordReveal(1, blockRoot, root(7)));
    expect(error.type).toEqual({
      code: BidLedgerErrorCode.REVEAL_CONFLICT,
      blockRoot,
      blockHash: root(7),
      revealedBlockHash: blockHash,
    });
  });

  it("sums each winning bid until its payment is explicitly settled", () => {
    const ledger = new BidLedger();
    const first = submittedBid({valueGwei: 100});
    const second = submittedBid({parentBlockRoot: root(8), blockHash: root(9), valueGwei: 50});
    ledger.recordBid(first);
    ledger.recordBid(second);

    expect(ledger.getUnsettledValueGwei(0)).toBe(0);
    ledger.recordWin(first, root(6));
    ledger.recordWin(first, root(7));
    ledger.recordWin(second, root(10));

    expect(ledger.getUnsettledValueGwei(0)).toBe(150);
    expect(ledger.getUnsettledValueGwei(2)).toBe(150);
    expect(ledger.getUnsettledValueGwei(3)).toBe(150);
    expect(ledger.recordPaymentSettled(first)).toEqual({...first, wonBlockRoots: [root(6), root(7)]});
    expect(ledger.recordPaymentSettled(first)).toEqual({...first, wonBlockRoots: [root(6), root(7)]});
    expect(ledger.getUnsettledValueGwei(3)).toBe(50);
  });

  it("only settles an exact winning bid identity", () => {
    const ledger = new BidLedger();
    const bid = submittedBid();
    ledger.recordBid(bid);

    expect(ledger.recordPaymentSettled(bid)).toBeNull();
    ledger.recordWin(bid, root(6));
    expect(ledger.recordPaymentSettled({...bid, blockHash: root(7)})).toBeNull();
    expect(ledger.getUnsettledValueGwei(4)).toBe(bid.valueGwei);
  });

  it("fails closed if unsettled liability exceeds the safe integer range", () => {
    const ledger = new BidLedger();
    const first = submittedBid({valueGwei: Number.MAX_SAFE_INTEGER});
    const second = submittedBid({parentBlockRoot: root(8), blockHash: root(9), valueGwei: 1});
    ledger.recordBid(first);
    ledger.recordBid(second);
    ledger.recordWin(first, root(6));
    ledger.recordWin(second, root(7));

    const error = getBidLedgerError(() => ledger.getUnsettledValueGwei(0));

    expect(error.type).toEqual({code: BidLedgerErrorCode.UNSETTLED_VALUE_OVERFLOW, currentEpoch: 0});
  });

  it("returns snapshots that cannot mutate ledger state", () => {
    const ledger = new BidLedger();
    const bid = submittedBid();
    ledger.recordBid(bid);
    ledger.recordWin(bid, root(6));

    const [snapshot] = ledger.getBidsForSlot(bid.slot);
    snapshot?.wonBlockRoots.push(root(7));

    expect(ledger.getBidsForSlot(bid.slot)).toEqual([{...bid, wonBlockRoots: [root(6)]}]);
  });

  it("retains unsettled winning bids past the retention boundary", () => {
    const ledger = new BidLedger();
    const bid = submittedBid();
    const blockRoot = root(6);
    ledger.recordBid(bid);
    ledger.recordWin(bid, blockRoot);
    ledger.recordReveal(bid.slot, blockRoot, bid.blockHash);

    expect(ledger.prune(bid.slot + 3 * SLOTS_PER_EPOCH)).toBe(0);
    expect(ledger.hasSubmitted(bid.slot, bid.parentBlockHash, bid.parentBlockRoot)).toBe(true);
    expect(ledger.hasRevealed(blockRoot)).toBe(true);

    expect(ledger.prune(bid.slot + 3 * SLOTS_PER_EPOCH + 1)).toBe(0);
    expect(ledger.hasSubmitted(bid.slot, bid.parentBlockHash, bid.parentBlockRoot)).toBe(true);
    expect(ledger.hasRevealed(blockRoot)).toBe(false);

    ledger.recordPaymentSettled(bid);
    expect(ledger.prune(bid.slot + 3 * SLOTS_PER_EPOCH + 1)).toBe(1);
    expect(ledger.hasSubmitted(bid.slot, bid.parentBlockHash, bid.parentBlockRoot)).toBe(false);
  });

  it("prunes old bids that never won", () => {
    const ledger = new BidLedger();
    const bid = submittedBid();
    ledger.recordBid(bid);

    expect(ledger.prune(bid.slot + 3 * SLOTS_PER_EPOCH + 1)).toBe(1);
    expect(ledger.hasSubmitted(bid.slot, bid.parentBlockHash, bid.parentBlockRoot)).toBe(false);
  });

  it("prunes reveal protection even when no winning bid record exists", () => {
    const ledger = new BidLedger();
    const blockRoot = root(6);
    ledger.recordReveal(1, blockRoot, root(4));

    expect(ledger.prune(1 + 3 * SLOTS_PER_EPOCH + 1)).toBe(0);
    expect(ledger.hasRevealed(blockRoot)).toBe(false);
  });

  it("preserves the original reveal slot on an idempotent repeat", () => {
    const ledger = new BidLedger();
    const blockRoot = root(6);
    const blockHash = root(4);
    ledger.recordReveal(10, blockRoot, blockHash);
    ledger.recordReveal(1, blockRoot, blockHash);

    ledger.prune(1 + 3 * SLOTS_PER_EPOCH + 1);

    expect(ledger.hasRevealed(blockRoot)).toBe(true);
  });
});

function submittedBid(overrides: Partial<SubmittedBid> = {}): SubmittedBid {
  return {
    slot: 1,
    parentBlockHash: root(2),
    parentBlockRoot: root(3),
    blockHash: root(4),
    valueGwei: 100,
    ...overrides,
  };
}

function root(byte: number): RootHex {
  return toRootHex(Uint8Array.from({length: 32}, () => byte));
}

function getBidLedgerError(fn: () => unknown): BidLedgerError {
  try {
    fn();
    throw Error("Expected BidLedgerError");
  } catch (error) {
    if (!(error instanceof BidLedgerError)) {
      throw error;
    }
    return error;
  }
}
