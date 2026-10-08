import {beforeEach, describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {SeenExecutionProofs} from "../../../../src/chain/seenCache/seenExecutionProofs.js";

describe("SeenExecutionProofs", () => {
  const blockRoot = "0x01";
  let cache: SeenExecutionProofs;

  beforeEach(() => {
    cache = new SeenExecutionProofs();
  });

  it("keeps the first verified envelope per block root and proof type", () => {
    const first = ssz.eip8025.ExecutionProofEnvelope.defaultValue();
    first.proofType = 1;
    first.proofData = Uint8Array.from([1]);
    const second = {...first, proofData: Uint8Array.from([2])};
    const other = {...first, proofType: 2};

    cache.addVerified(blockRoot, 8, first);
    cache.addVerified(blockRoot, 8, second);
    cache.addVerified(blockRoot, 8, other);

    expect(cache.hasVerified(blockRoot, 1)).toBe(true);
    expect(cache.hasVerified(blockRoot, 3)).toBe(false);
    expect(cache.hasVerified("0x02", 1)).toBe(false);
    expect(cache.getVerified(blockRoot)).toEqual([first, other]);
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
    cache.addVerified("0x03", 16, ssz.eip8025.ExecutionProofEnvelope.defaultValue());

    cache.prune(16);

    expect(cache.isProofSeen("0x01", "0xaa")).toBe(false);
    expect(cache.isProofSeen("0x02", "0xbb")).toBe(true);
    expect(cache.hasVerified("0x03", 0)).toBe(true);
  });
});
