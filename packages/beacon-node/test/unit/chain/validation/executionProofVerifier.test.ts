import {describe, expect, it} from "vitest";
import {ExecutionProof} from "@lodestar/types";
import {DummyZkvmExecutionProofVerifier} from "../../../../src/chain/validation/executionProofVerifier.js";

function bytes32(byte: number): Uint8Array {
  return Uint8Array.from({length: 32}, () => byte);
}

function makeProof(overrides: Partial<ExecutionProof> = {}): ExecutionProof {
  return {
    proofData: Uint8Array.from([1, 2, 3]),
    proofType: 0,
    publicInput: {
      newPayloadRequestRoot: bytes32(0xaa),
    },
    ...overrides,
  };
}

describe("DummyZkvmExecutionProofVerifier", () => {
  const verifier = new DummyZkvmExecutionProofVerifier();

  describe("valid proofs", () => {
    it("accepts proofs when all basic checks pass", () => {
      const proofs = [makeProof({proofType: 0}), makeProof({proofType: 1})];

      const result = verifier.verifyProofs({proofs, minProofsRequired: 2});
      expect(result).toEqual({ok: true, distinctProofTypes: 2});
    });

    it("accepts when more proofs than minimum are present", () => {
      const proofs = [makeProof({proofType: 0}), makeProof({proofType: 1}), makeProof({proofType: 2})];

      const result = verifier.verifyProofs({proofs, minProofsRequired: 1});
      expect(result).toEqual({ok: true, distinctProofTypes: 3});
    });

    it("accepts with minProofsRequired=1 and a single proof", () => {
      const result = verifier.verifyProofs({
        proofs: [makeProof({proofType: 0})],
        minProofsRequired: 1,
      });
      expect(result).toEqual({ok: true, distinctProofTypes: 1});
    });
  });

  describe("empty proofData", () => {
    it("rejects when proofData is empty", () => {
      const result = verifier.verifyProofs({
        proofs: [makeProof({proofType: 0, proofData: Uint8Array.from([])})],
        minProofsRequired: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("empty proofData");
    });

    it("rejects on first empty proofData even if later proofs are valid", () => {
      const result = verifier.verifyProofs({
        proofs: [makeProof({proofType: 0, proofData: Uint8Array.from([])}), makeProof({proofType: 1})],
        minProofsRequired: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("empty proofData");
    });
  });

  describe("insufficient distinct proof types", () => {
    it("rejects when distinct proof types are below minimum", () => {
      const result = verifier.verifyProofs({
        proofs: [makeProof({proofType: 0}), makeProof({proofType: 0, proofData: Uint8Array.from([9, 9])})],
        minProofsRequired: 2,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("insufficient distinct proof types");
    });

    it("rejects when no proofs are provided", () => {
      const result = verifier.verifyProofs({proofs: [], minProofsRequired: 1});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("insufficient distinct proof types");
    });
  });
});
