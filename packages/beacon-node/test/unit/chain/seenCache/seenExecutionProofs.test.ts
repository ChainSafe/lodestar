import {beforeEach, describe, expect, it} from "vitest";
import {SeenExecutionProofs} from "../../../../src/chain/seenCache/seenExecutionProofs.js";

describe("SeenExecutionProofs", () => {
  const blockRoot = "0x01";
  let cache: SeenExecutionProofs;

  beforeEach(() => {
    cache = new SeenExecutionProofs();
  });

  it("tracks verified proof types per block root", () => {
    cache.addVerified(blockRoot, 8, 1);
    cache.addVerified(blockRoot, 8, 2);

    expect(cache.hasVerified(blockRoot, 1)).toBe(true);
    expect(cache.hasVerified(blockRoot, 2)).toBe(true);
    expect(cache.hasVerified(blockRoot, 3)).toBe(false);
    expect(cache.hasVerified("0x02", 1)).toBe(false);
  });

  it("tracks processed proof roots and prover attempts per block root", () => {
    cache.markSeen(blockRoot, 8, "0xaa", 1, 3);

    expect(cache.isProofSeen(blockRoot, "0xaa")).toBe(true);
    expect(cache.isProofSeen(blockRoot, "0xbb")).toBe(false);
    expect(cache.isProofSeen("0x02", "0xaa")).toBe(false);
    expect(cache.isProverSeen(blockRoot, 1, 3)).toBe(true);
    expect(cache.isProverSeen(blockRoot, 2, 3)).toBe(false);
    expect(cache.isProverSeen(blockRoot, 1, 4)).toBe(false);
  });

  it("prunes blocks below the finalized slot", () => {
    cache.markSeen("0x01", 8, "0xaa", 1, 3);
    cache.markSeen("0x02", 16, "0xbb", 1, 3);
    cache.addVerified("0x03", 16, 0);

    cache.prune(16);

    expect(cache.isProofSeen("0x01", "0xaa")).toBe(false);
    expect(cache.isProofSeen("0x02", "0xbb")).toBe(true);
    expect(cache.hasVerified("0x03", 0)).toBe(true);
  });
});
