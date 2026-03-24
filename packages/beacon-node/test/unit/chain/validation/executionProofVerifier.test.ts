import {describe, expect, it} from "vitest";
import {SignedExecutionProof} from "@lodestar/types";
import {DummyZkvmExecutionProofVerifier} from "../../../../src/chain/validation/executionProofVerifier.js";

const ROOT_A = Uint8Array.from({length: 32}, () => 0xaa);

function createSignedProof(overrides: {proofType?: number; proofData?: Uint8Array} = {}): SignedExecutionProof {
  return {
    message: {
      proofData: overrides.proofData ?? new Uint8Array(64),
      proofType: overrides.proofType ?? 0,
      publicInput: {newPayloadRequestRoot: ROOT_A},
    },
    validatorIndex: 0,
    signature: new Uint8Array(96),
  };
}

describe("DummyZkvmExecutionProofVerifier", () => {
  const verifier = new DummyZkvmExecutionProofVerifier();

  it("should pass with enough distinct proof types", () => {
    const proofs = [createSignedProof({proofType: 0}), createSignedProof({proofType: 1})];
    const result = verifier.verifyProofs({proofs, minProofsRequired: 2});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.distinctProofTypes).toBe(2);
  });

  it("should fail with insufficient distinct proof types", () => {
    const proofs = [createSignedProof({proofType: 0})];
    const result = verifier.verifyProofs({proofs, minProofsRequired: 2});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("insufficient");
  });

  it("should fail when proofData is empty", () => {
    const proofs = [createSignedProof({proofData: new Uint8Array(0)})];
    const result = verifier.verifyProofs({proofs, minProofsRequired: 1});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("empty proofData");
  });

  it("should count distinct proof types correctly (duplicates don't double-count)", () => {
    const proofs = [
      createSignedProof({proofType: 0}),
      createSignedProof({proofType: 0}),
      createSignedProof({proofType: 1}),
    ];
    const result = verifier.verifyProofs({proofs, minProofsRequired: 2});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.distinctProofTypes).toBe(2);
  });

  it("should pass with zero proofs when minRequired is 0", () => {
    const result = verifier.verifyProofs({proofs: [], minProofsRequired: 0});
    expect(result.ok).toBe(true);
  });

  it("should fail when empty proofData appears before threshold met", () => {
    const proofs = [createSignedProof({proofType: 0}), createSignedProof({proofType: 1, proofData: new Uint8Array(0)})];
    const result = verifier.verifyProofs({proofs, minProofsRequired: 2});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("empty proofData");
  });
});
