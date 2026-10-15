import {existsSync, readFileSync} from "node:fs";
import {beforeAll, describe, expect, it} from "vitest";
import {
  EXECUTION_PROOF_MAX_SIZE,
  EXECUTION_PROOF_VERIFIER_AVAILABLE,
  hasExecutionProofVerifier,
} from "@chainsafe/lodestar-z/execution-proof-verifier";
import {toHex} from "@lodestar/utils";
import {NativeProofEngine, verifyNativeExecutionProof} from "../../../../src/chain/proofEngine/native.js";

describe.skipIf(!EXECUTION_PROOF_VERIFIER_AVAILABLE)("NativeProofEngine native binding", () => {
  const proofType = 210;
  const expectedPublicInput = new Uint8Array(32);
  let engine: NativeProofEngine;

  beforeAll(() => {
    engine = new NativeProofEngine([{proofType, zkvm: "sp1", programVk: toHex(new Uint8Array(32))}], null);
  });

  it("registers the verifier through lodestar-z", () => {
    expect(hasExecutionProofVerifier(proofType)).toBe(true);
    expect([...engine.supportedProofTypes]).toEqual([proofType]);
  });

  it("propagates the native error for a duplicate proof type", () => {
    expect(() => new NativeProofEngine([{proofType, zkvm: "sp1", programVk: toHex(new Uint8Array(32))}], null)).toThrow(
      "ProofTypeAlreadyRegistered"
    );
  });

  it("rejects malformed proof bytes through the native verifier", async () => {
    await expect(
      verifyNativeExecutionProof(proofType, new TextEncoder().encode("not a proof"), expectedPublicInput)
    ).resolves.toBe("invalid_proof");
  });

  it("propagates the native error for an unregistered proof type", async () => {
    await expect(verifyNativeExecutionProof(proofType + 1, new Uint8Array(1), expectedPublicInput)).rejects.toThrow(
      "ProofTypeNotRegistered"
    );
  });

  it("propagates the native proof size limit", async () => {
    await expect(
      verifyNativeExecutionProof(proofType, new Uint8Array(EXECUTION_PROOF_MAX_SIZE + 1), expectedPublicInput)
    ).rejects.toThrow("ProofTooLarge");
  });

  describe.each([
    {zkvm: "openvm", proofType: 220},
    {zkvm: "sp1", proofType: 221},
    {zkvm: "zisk", proofType: 222},
  ] as const)("$zkvm fixture", ({zkvm, proofType}) => {
    let proofData: Uint8Array;
    let publicValues: Uint8Array;

    beforeAll(() => {
      const fixtureDir = new URL(`../../../fixtures/executionProofs/${zkvm}/`, import.meta.url);
      for (const file of ["program_vk.bin", "proof.bin", "public_values.bin"]) {
        expect(
          existsSync(new URL(file, fixtureDir)),
          `Missing ${zkvm}/${file}. Run "pnpm download-execution-proofs-fixtures" before running native proof tests.`
        ).toBe(true);
      }
      const programVk = toHex(readFileSync(new URL("program_vk.bin", fixtureDir)));
      proofData = Uint8Array.from(readFileSync(new URL("proof.bin", fixtureDir)));
      publicValues = Uint8Array.from(readFileSync(new URL("public_values.bin", fixtureDir)));
      new NativeProofEngine([{proofType, zkvm, programVk}], null);
    });

    it("accepts a valid proof", async () => {
      await expect(verifyNativeExecutionProof(proofType, proofData, publicValues)).resolves.toBe("valid");
    });

    it("rejects a corrupted proof", async () => {
      const corrupted = proofData.slice();
      corrupted[Math.floor(corrupted.length / 2)] ^= 1;
      await expect(verifyNativeExecutionProof(proofType, corrupted, publicValues)).resolves.toBe("invalid_proof");
    });

    it("rejects a valid proof with mismatched public values", async () => {
      const wrongPublicValues = publicValues.slice();
      wrongPublicValues[0] ^= 1;
      await expect(verifyNativeExecutionProof(proofType, proofData, wrongPublicValues)).resolves.toBe(
        "public_input_mismatch"
      );
    });
  });
});
