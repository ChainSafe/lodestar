import {beforeEach, describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {SeenExecutionProofs} from "../../../../src/chain/seenCache/seenExecutionProofs.js";

describe("SeenExecutionProofs", () => {
  const blockRoot = "0x01";
  let cache: SeenExecutionProofs;

  beforeEach(() => {
    cache = new SeenExecutionProofs();
  });

  it("stores verified envelopes by block root and proof type", () => {
    const proof1 = ssz.eip8025.ExecutionProofEnvelope.defaultValue();
    proof1.proofType = 1;
    proof1.proofData = Uint8Array.from([1, 2, 3]);
    const proof2 = ssz.eip8025.ExecutionProofEnvelope.defaultValue();
    proof2.proofType = 2;
    proof2.proofData = Uint8Array.from([4, 5, 6]);
    cache.addVerified(blockRoot, 8, proof1);
    cache.addVerified(blockRoot, 8, proof2);

    expect(cache.hasVerified(blockRoot, 1)).toBe(true);
    expect(cache.hasVerified(blockRoot, 2)).toBe(true);
    expect(cache.hasVerified(blockRoot, 3)).toBe(false);
    expect(cache.hasVerified("0x02", 1)).toBe(false);
    expect(cache.getVerified(blockRoot, 1)).toBe(proof1);
    expect(cache.getVerified(blockRoot, 2)).toBe(proof2);
    expect(cache.getVerified(blockRoot, 3)).toBeUndefined();
    expect(cache.getVerified("0x02", 1)).toBeUndefined();
  });

  it("keeps the first verified envelope for each block root and proof type", () => {
    const proof1 = ssz.eip8025.ExecutionProofEnvelope.defaultValue();
    proof1.proofType = 1;
    proof1.proofData = Uint8Array.from([1, 2, 3]);
    const proof2 = ssz.eip8025.ExecutionProofEnvelope.defaultValue();
    proof2.proofType = 1;
    proof2.proofData = Uint8Array.from([4, 5, 6]);
    cache.addVerified(blockRoot, 8, proof1);
    cache.addVerified(blockRoot, 8, proof2);
    cache.addVerified("0x02", 8, proof2);

    expect(cache.getVerified(blockRoot, 1)).toBe(proof1);
    expect(cache.getVerified("0x02", 1)).toBe(proof2);
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
    const proof = ssz.eip8025.ExecutionProofEnvelope.defaultValue();
    proof.proofType = 1;
    proof.proofData = Uint8Array.from([1, 2, 3]);
    cache.addVerified("0x01", 8, proof);
    cache.addVerified("0x03", 16, proof);

    cache.prune(16);

    expect(cache.isProofSeen("0x01", "0xaa")).toBe(false);
    expect(cache.isProverSeen("0x01", 1, 3)).toBe(false);
    expect(cache.hasVerified("0x01", 1)).toBe(false);
    expect(cache.getVerified("0x01", 1)).toBeUndefined();
    expect(cache.isProofSeen("0x02", "0xbb")).toBe(true);
    expect(cache.hasVerified("0x03", 1)).toBe(true);
    expect(cache.getVerified("0x03", 1)).toBe(proof);
  });
});
