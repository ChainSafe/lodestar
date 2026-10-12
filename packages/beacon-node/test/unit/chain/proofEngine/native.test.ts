import {beforeEach, describe, expect, it, vi} from "vitest";
import {eip8025, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {
  ExecutionProofVerifier,
  NativeProofEngine,
  matchesPublicInput,
} from "../../../../src/chain/proofEngine/native.js";

describe("NativeProofEngine", () => {
  const vk = Uint8Array.from([1, 2, 3, 4]);
  let verifier: {
    [K in keyof ExecutionProofVerifier]: ExecutionProofVerifier[K] extends (...args: never[]) => unknown
      ? ReturnType<typeof vi.fn<ExecutionProofVerifier[K]>>
      : ExecutionProofVerifier[K];
  };
  let proof: eip8025.ExecutionProof;

  beforeEach(() => {
    verifier = {
      ZKVM_KIND: {openvm: 0, sp1: 1, zisk: 2, lambdavm: 3},
      EXECUTION_PROOF_VERIFIER_AVAILABLE: true,
      registerExecutionProofVerifier: vi.fn(),
      verifyExecutionProof: vi.fn(),
    };
    proof = ssz.eip8025.ExecutionProof.defaultValue();
    proof.proofType = 2;
    proof.proofData = Uint8Array.from([9, 9, 9]);
    proof.publicInput = {
      newPayloadRequestRoot: Buffer.alloc(32, 7),
      successfulValidation: true,
      chainId: 1,
      schemaId: 0x1501,
    };
  });

  it("registers one verifier per configured proof type", () => {
    const engine = new NativeProofEngine(
      verifier,
      [
        {proofType: 1, zkvm: "sp1", programVk: toHex(vk)},
        {proofType: 2, zkvm: "zisk", programVk: toHex(vk)},
      ],
      null
    );

    expect(verifier.registerExecutionProofVerifier.mock.calls).toEqual([
      [1, 1, vk],
      [2, 2, vk],
    ]);
    expect([...engine.supportedProofTypes]).toEqual([1, 2]);
  });

  it("refuses to start on a platform without the prebuilt verifier", () => {
    verifier.EXECUTION_PROOF_VERIFIER_AVAILABLE = false;
    expect(() => new NativeProofEngine(verifier, [{proofType: 1, zkvm: "sp1", programVk: toHex(vk)}], null)).toThrow(
      "not built for this platform"
    );
    expect(verifier.registerExecutionProofVerifier).not.toHaveBeenCalled();
  });

  it("accepts a proof whose public values are the serialized public input", async () => {
    const engine = new NativeProofEngine(verifier, [{proofType: 2, zkvm: "sp1", programVk: toHex(vk)}], null);
    verifier.verifyExecutionProof.mockResolvedValue(ssz.eip8025.PublicInput.serialize(proof.publicInput));

    await expect(engine.verifyExecutionProof(proof)).resolves.toBe(true);
    expect(verifier.verifyExecutionProof).toHaveBeenCalledWith(2, proof.proofData);
  });

  it("rejects a proof the verifier does not accept", async () => {
    const engine = new NativeProofEngine(verifier, [{proofType: 2, zkvm: "sp1", programVk: toHex(vk)}], null);
    verifier.verifyExecutionProof.mockResolvedValue(null);

    await expect(engine.verifyExecutionProof(proof)).resolves.toBe(false);
  });

  it("rejects a valid proof over a different public input", async () => {
    const engine = new NativeProofEngine(verifier, [{proofType: 2, zkvm: "sp1", programVk: toHex(vk)}], null);
    const other = {...proof.publicInput, chainId: 2};
    verifier.verifyExecutionProof.mockResolvedValue(ssz.eip8025.PublicInput.serialize(other));

    await expect(engine.verifyExecutionProof(proof)).resolves.toBe(false);
  });

  describe("matchesPublicInput", () => {
    const publicInput: eip8025.PublicInput = {
      newPayloadRequestRoot: Buffer.alloc(32, 3),
      successfulValidation: true,
      chainId: 1,
      schemaId: 0x1501,
    };
    const serialized = ssz.eip8025.PublicInput.serialize(publicInput);

    it("is 43 bytes for the stateless input schema", () => {
      expect(serialized.length).toBe(43);
    });

    it("accepts the exact serialization and a zero-padded one", () => {
      expect(matchesPublicInput(serialized, publicInput)).toBe(true);
      const padded = new Uint8Array(256);
      padded.set(serialized);
      expect(matchesPublicInput(padded, publicInput)).toBe(true);
    });

    it("rejects truncated, altered or non-zero padded values", () => {
      expect(matchesPublicInput(serialized.subarray(0, 42), publicInput)).toBe(false);
      const altered = serialized.slice();
      altered[0] ^= 1;
      expect(matchesPublicInput(altered, publicInput)).toBe(false);
      const padded = new Uint8Array(64);
      padded.set(serialized);
      padded[63] = 1;
      expect(matchesPublicInput(padded, publicInput)).toBe(false);
    });
  });
});
