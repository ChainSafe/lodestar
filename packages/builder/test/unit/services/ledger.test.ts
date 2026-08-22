import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Ledger} from "../../../src/services/ledger.js";

describe("Ledger", () => {
  const parentBlockHash = "0x" + "aa".repeat(32);
  const parentBlockRoot = "0x" + "bb".repeat(32);
  const blockHash = "0x" + "cc".repeat(32);
  const blockRoot = "0x" + "dd".repeat(32);

  function recordBid(ledger: Ledger, slot: number, valueGwei = 100): void {
    ledger.recordBid({slot, parentBlockHash, parentBlockRoot, blockHash, valueGwei});
  }

  it("tracks submitted tuples", () => {
    const ledger = new Ledger();
    expect(ledger.hasSubmitted(1, parentBlockHash, parentBlockRoot)).toBe(false);
    recordBid(ledger, 1);
    expect(ledger.hasSubmitted(1, parentBlockHash, parentBlockRoot)).toBe(true);
    expect(ledger.hasSubmitted(2, parentBlockHash, parentBlockRoot)).toBe(false);
  });

  it("rejects a second bid for the same tuple", () => {
    const ledger = new Ledger();
    recordBid(ledger, 1);
    expect(() => recordBid(ledger, 1)).toThrow();
  });

  it("records wins against the matching bid", () => {
    const ledger = new Ledger();
    recordBid(ledger, 1);
    expect(ledger.recordWin(1, "0x" + "ee".repeat(32), blockRoot)).toBeNull();
    const record = ledger.recordWin(1, blockHash, blockRoot);
    expect(record?.wonBlockRoots).toEqual([blockRoot]);
    // Duplicate win for the same block root is not recorded twice
    ledger.recordWin(1, blockHash, blockRoot);
    expect(record?.wonBlockRoots).toEqual([blockRoot]);
  });

  it("allows one envelope per block root", () => {
    const ledger = new Ledger();
    expect(ledger.canReveal(blockRoot, blockHash)).toBe(true);
    ledger.recordReveal(blockRoot, blockHash);
    expect(ledger.hasRevealed(blockRoot)).toBe(true);
    expect(ledger.canReveal(blockRoot, blockHash)).toBe(true);
    expect(ledger.canReveal(blockRoot, "0x" + "ee".repeat(32))).toBe(false);
    expect(() => ledger.recordReveal(blockRoot, "0x" + "ee".repeat(32))).toThrow();
  });

  it("sums unsettled won bids", () => {
    const ledger = new Ledger();
    recordBid(ledger, 1, 100);
    expect(ledger.getUnsettledValueGwei(0)).toEqual(0);
    ledger.recordWin(1, blockHash, blockRoot);
    expect(ledger.getUnsettledValueGwei(0)).toEqual(100);
    expect(ledger.getUnsettledValueGwei(2)).toEqual(100);
    // Settled after two epochs
    expect(ledger.getUnsettledValueGwei(3)).toEqual(0);
  });

  it("prunes old records", () => {
    const ledger = new Ledger();
    recordBid(ledger, 1);
    ledger.recordWin(1, blockHash, blockRoot);
    ledger.recordReveal(blockRoot, blockHash);
    ledger.prune(1 + 3 * SLOTS_PER_EPOCH + 1);
    expect(ledger.hasSubmitted(1, parentBlockHash, parentBlockRoot)).toBe(false);
    expect(ledger.hasRevealed(blockRoot)).toBe(false);
  });
});
