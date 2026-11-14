import {describe, expect, it} from "vitest";
import {toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {
  BuilderPaymentAccounting,
  type BuilderPaymentDecision,
  type BuilderPaymentSnapshot,
} from "../../../src/services/builderPaymentAccounting.js";

function setup() {
  const ledger = new BidLedger();
  const bids = [1, 2, 3].map((slot) => {
    const bid = ledger.recordBid({
      slot,
      parentBlockRoot: toRootHex(Buffer.alloc(32, slot)),
      parentBlockHash: toRootHex(Buffer.alloc(32, slot + 10)),
      blockHash: toRootHex(Buffer.alloc(32, slot + 20)),
      signedBidRoot: toRootHex(Buffer.alloc(32, slot + 30)),
      valueGwei: 10,
    });
    const won = ledger.recordWin(bid, toRootHex(Buffer.alloc(32, slot + 40)));
    if (!won) throw Error("Fixture bid was not recorded");
    return won;
  });
  const snapshot: BuilderPaymentSnapshot = {
    slot: 10,
    snapshotBlockRoot: toRootHex(Buffer.alloc(32, 100)),
    stateRoot: toRootHex(Buffer.alloc(32, 101)),
    builderIndex: 0,
    balanceGwei: 90,
  };
  const decisions: BuilderPaymentDecision[] = [
    {bid: bids[0], selectedBlockRoot: bids[0].wonBlockRoots[0], outcome: "paid"},
    {bid: bids[1], selectedBlockRoot: bids[1].wonBlockRoots[0], outcome: "cancelled"},
  ];
  const accounting = new BuilderPaymentAccounting(ledger, 0);
  const context = {snapshotBlockRoot: snapshot.snapshotBlockRoot, currentSlot: snapshot.slot, maxSnapshotAgeSlots: 0};
  const signal = new AbortController().signal;
  return {ledger, bids, snapshot, decisions, accounting, context, signal};
}

describe("BuilderPaymentAccounting", () => {
  it.each([false, true])("applies paid and cancelled outcomes atomically (reverse=%s)", (reverse) => {
    const {accounting, ledger, snapshot, decisions, context, signal} = setup();
    accounting.applySnapshot(snapshot, reverse ? decisions.toReversed() : decisions, 0, signal);
    expect(ledger.getUnsettledValueGwei(0)).toBe(10);
    expect(accounting.getAvailableBalanceGwei(context)).toBe(80);
  });

  it("refreshes the balance without releasing unresolved obligations", () => {
    const {accounting, ledger, snapshot, context, signal} = setup();
    accounting.applySnapshot(snapshot, [], 0, signal);
    expect(ledger.getUnsettledValueGwei(0)).toBe(30);
    expect(accounting.getAvailableBalanceGwei(context)).toBe(60);
  });

  it.each(["changed_bid", "changed_roots", "unselected", "duplicate"])(
    "rejects the complete batch when a later decision is invalid (%s)",
    (scenario) => {
      const {accounting, ledger, snapshot, decisions, context, signal} = setup();
      if (scenario === "changed_bid") decisions[1].bid = {...decisions[1].bid, valueGwei: 11};
      if (scenario === "changed_roots") ledger.recordWin(decisions[1].bid, toRootHex(Buffer.alloc(32, 120)));
      if (scenario === "unselected") decisions[1].selectedBlockRoot = toRootHex(Buffer.alloc(32, 121));
      if (scenario === "duplicate") decisions[1] = decisions[0];
      expect(() => accounting.applySnapshot(snapshot, decisions, 0, signal)).toThrow();
      expect(ledger.getUnsettledValueGwei(0)).toBe(30);
      expect(accounting.getAvailableBalanceGwei(context)).toBeNull();
      expect(accounting.getCheckpoint().revision).toBe(0);
    }
  );

  it.each([
    {builderIndex: 1},
    {balanceGwei: -1},
    {balanceGwei: Number.NaN},
    {balanceGwei: Number.MAX_SAFE_INTEGER + 1},
    {slot: -1},
    {slot: 1.5},
  ])("rejects an invalid snapshot %j before changing the ledger", (change) => {
    const {accounting, ledger, snapshot, decisions, signal} = setup();
    expect(() => accounting.applySnapshot({...snapshot, ...change}, decisions, 0, signal)).toThrow();
    expect(ledger.getUnsettledValueGwei(0)).toBe(30);
  });

  it("does not use a balance from before the selected bid", () => {
    const {accounting, ledger, snapshot, decisions, signal} = setup();
    expect(() => accounting.applySnapshot({...snapshot, slot: 1}, decisions, 0, signal)).toThrow();
    expect(ledger.getUnsettledValueGwei(0)).toBe(30);
  });

  it("discards cancelled and overlapping reads", () => {
    const {accounting, ledger, snapshot, decisions, signal} = setup();
    const revision = accounting.getCheckpoint().revision;
    const controller = new AbortController();
    controller.abort();
    expect(() => accounting.applySnapshot(snapshot, decisions, revision, controller.signal)).toThrow();
    expect(ledger.getUnsettledValueGwei(0)).toBe(30);
    accounting.applySnapshot(snapshot, decisions, revision, signal);
    expect(() => accounting.applySnapshot(snapshot, decisions, revision, signal)).toThrow();
    expect(ledger.getUnsettledValueGwei(0)).toBe(10);
  });

  it.each([
    {slot: 9},
    {snapshotBlockRoot: toRootHex(Buffer.alloc(32, 120))},
    {stateRoot: toRootHex(Buffer.alloc(32, 121))},
    {balanceGwei: 100},
  ])("rejects older or inconsistent evidence %j", (change) => {
    const {accounting, ledger, snapshot, decisions, context, signal} = setup();
    accounting.applySnapshot(snapshot, decisions.slice(0, 1), 0, signal);
    expect(() => accounting.applySnapshot({...snapshot, ...change}, decisions.slice(1), 1, signal)).toThrow();
    expect(ledger.getUnsettledValueGwei(0)).toBe(20);
    expect(accounting.getAvailableBalanceGwei(context)).toBe(70);
  });

  it("never returns a stale balance or uses an invalidated anchor", () => {
    const {accounting, ledger, snapshot, decisions, context, signal} = setup();
    accounting.applySnapshot(snapshot, decisions, 0, signal);
    expect(accounting.getAvailableBalanceGwei({...context, currentSlot: context.currentSlot + 1})).toBeNull();
    expect(ledger.getUnsettledValueGwei(0)).toBe(10);
    accounting.invalidateAnchor();
    expect(accounting.getAvailableBalanceGwei(context)).toBeNull();
    expect(() => accounting.applySnapshot(snapshot, [], 1, signal)).toThrow();
  });

  it("does not retain caller-owned snapshot references", () => {
    const {accounting, snapshot, context, signal} = setup();
    accounting.applySnapshot(snapshot, [], 0, signal);
    snapshot.balanceGwei = 1_000;
    const checkpoint = accounting.getCheckpoint();
    if (checkpoint.snapshot) checkpoint.snapshot.balanceGwei = 2_000;
    expect(accounting.getAvailableBalanceGwei(context)).toBe(60);
  });
});
