import {describe, expect, it} from "vitest";
import {ExecutionProof} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {DummyZkevmExecutionProofVerifier} from "../../../../src/chain/validation/executionProofVerifier.js";

function bytes32(byte: number): Uint8Array {
  return Uint8Array.from({length: 32}, () => byte);
}

function makeProof(overrides: Partial<ExecutionProof> & {proofId: number}): ExecutionProof {
  return {
    slot: 123,
    blockHash: bytes32(0xbb),
    blockRoot: bytes32(0xaa),
    proofData: Uint8Array.from([1, 2, 3]),
    ...overrides,
  };
}

describe("DummyZkevmExecutionProofVerifier", () => {
  const verifier = new DummyZkevmExecutionProofVerifier();
  const blockRoot = bytes32(0xaa);
  const blockHash = bytes32(0xbb);
  const expectedBlockRootHex = toRootHex(blockRoot);
  const expectedExecBlockHashHex = toRootHex(blockHash);

  describe("valid proofs", () => {
    it("accepts proofs when all basic checks pass", () => {
      const proofs = [makeProof({proofId: 0, blockHash, blockRoot}), makeProof({proofId: 1, blockHash, blockRoot})];

      const result = verifier.verifyProofs({
        proofs,
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 2,
      });

      expect(result).toEqual({ok: true, distinctProofTypes: 2});
    });

    it("accepts when more proofs than minimum are present", () => {
      const proofs = [
        makeProof({proofId: 0, blockHash, blockRoot}),
        makeProof({proofId: 1, blockHash, blockRoot}),
        makeProof({proofId: 2, blockHash, blockRoot}),
      ];

      const result = verifier.verifyProofs({
        proofs,
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 1,
      });

      expect(result).toEqual({ok: true, distinctProofTypes: 3});
    });

    it("accepts with minProofsRequired=1 and a single proof", () => {
      const result = verifier.verifyProofs({
        proofs: [makeProof({proofId: 0, blockHash, blockRoot})],
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 1,
      });

      expect(result).toEqual({ok: true, distinctProofTypes: 1});
    });
  });

  describe("empty proofData", () => {
    it("rejects when proofData is empty", () => {
      const result = verifier.verifyProofs({
        proofs: [makeProof({proofId: 0, blockHash, blockRoot, proofData: Uint8Array.from([])})],
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("empty proofData");
    });

    it("rejects on first empty proofData even if later proofs are valid", () => {
      const result = verifier.verifyProofs({
        proofs: [
          makeProof({proofId: 0, blockHash, blockRoot, proofData: Uint8Array.from([])}),
          makeProof({proofId: 1, blockHash, blockRoot}),
        ],
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("empty proofData");
    });
  });

  describe("blockRoot mismatch", () => {
    it("rejects when proof blockRoot does not match expected", () => {
      const wrongBlockRoot = bytes32(0xff);

      const result = verifier.verifyProofs({
        proofs: [makeProof({proofId: 0, blockHash, blockRoot: wrongBlockRoot})],
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("blockRoot mismatch");
    });
  });

  describe("blockHash mismatch", () => {
    it("rejects when proof blockHash does not match expected", () => {
      const wrongBlockHash = bytes32(0xff);

      const result = verifier.verifyProofs({
        proofs: [makeProof({proofId: 0, blockHash: wrongBlockHash, blockRoot})],
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("blockHash mismatch");
    });
  });

  describe("insufficient distinct proof types", () => {
    it("rejects when distinct proof types are below minimum", () => {
      const result = verifier.verifyProofs({
        proofs: [
          makeProof({proofId: 0, blockHash, blockRoot}),
          makeProof({proofId: 0, blockHash, blockRoot, proofData: Uint8Array.from([9, 9])}),
        ],
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 2,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("insufficient distinct proof types");
    });

    it("rejects when no proofs are provided", () => {
      const result = verifier.verifyProofs({
        proofs: [],
        expectedBlockRootHex,
        expectedExecBlockHashHex,
        minProofsRequired: 1,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("insufficient distinct proof types");
    });
  });
});
