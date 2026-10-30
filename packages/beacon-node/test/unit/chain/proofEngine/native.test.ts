import {beforeEach, describe, expect, it, vi} from "vitest";
import type {
  registerExecutionProofVerifier,
  verifyExecutionProof,
} from "@chainsafe/lodestar-z/execution-proof-verifier";
import {eip8025, ssz} from "@lodestar/types";
import {LodestarError, toHex} from "@lodestar/utils";
import {ExecutionProofInput} from "../../../../src/chain/proofEngine/executionProof.js";
import {NativeProofEngine, matchesPublicInput} from "../../../../src/chain/proofEngine/native.js";
import {createMetricsTest} from "../../metrics/utils.js";

const verifier = vi.hoisted(() => ({
  ZKVM_KIND: {openvm: 0, sp1: 1, zisk: 2, lambdavm: 3},
  EXECUTION_PROOF_VERIFIER_AVAILABLE: true,
  registerExecutionProofVerifier: vi.fn<typeof registerExecutionProofVerifier>(),
  verifyExecutionProof: vi.fn<typeof verifyExecutionProof>(),
}));

/** Proof types 1-3 assigned to a key the test controls, so the engine's digest check can pass */
const assignments = await vi.hoisted(async () => {
  const {digest} = await import("@chainsafe/as-sha256");
  const {toHex} = await import("@lodestar/utils");
  const vk = Uint8Array.from([1, 2, 3, 4]);
  const verificationKeyDigest = toHex(digest(vk));
  const assign = (zkvm: "openvm" | "sp1" | "zisk") => ({
    statelessValidator: "test guest",
    zkvm,
    zkvmVersion: "test",
    verificationKeyDigest,
  });
  return {
    vk,
    table: new Map([
      [1, assign("openvm")],
      [2, assign("sp1")],
      [3, assign("zisk")],
    ]),
  };
});

vi.mock("@chainsafe/lodestar-z/execution-proof-verifier", () => verifier);
vi.mock("@lodestar/params", async (importActual) => ({
  ...(await importActual<typeof import("@lodestar/params")>()),
  EXECUTION_PROOF_TYPES: assignments.table,
}));

describe("NativeProofEngine", () => {
  const {vk} = assignments;
  let proof: eip8025.ExecutionProof;
  let input: ExecutionProofInput;

  beforeEach(() => {
    vi.resetAllMocks();
    verifier.EXECUTION_PROOF_VERIFIER_AVAILABLE = true;
    proof = ssz.eip8025.ExecutionProof.defaultValue();
    proof.proofType = 2;
    proof.proofData = Uint8Array.from([9, 9, 9]);
    proof.publicInput = {
      newPayloadRequestRoot: Buffer.alloc(32, 7),
      successfulValidation: true,
      chainId: 9007199254740993n,
      schemaId: 0x1501,
    };
    input = {proof, publicInputs: [{convention: "spec", publicInput: proof.publicInput}]};
  });

  it("registers one verifier per configured proof type with its assigned zkVM", () => {
    const engine = new NativeProofEngine(
      [
        {proofType: 1, verificationKey: toHex(vk)},
        {proofType: 2, verificationKey: toHex(vk)},
        {proofType: 3, verificationKey: toHex(vk)},
      ],
      null
    );

    expect(verifier.registerExecutionProofVerifier.mock.calls).toEqual([
      [1, 0, vk],
      [2, 1, vk],
      [3, 2, vk],
    ]);
    expect([...engine.verifiableProofTypes]).toEqual([1, 2, 3]);
    expect([...engine.supportedProofTypes]).toEqual([1, 2, 3]);
  });

  it("registers an explicit assignment without consulting the table and supports its type", () => {
    const otherKey = Uint8Array.from([4, 3, 2, 1]);
    const engine = new NativeProofEngine(
      [
        {proofType: 2, verificationKey: toHex(otherKey), zkvm: "zisk"},
        {proofType: 8, verificationKey: toHex(otherKey), zkvm: "sp1"},
      ],
      null
    );

    expect(verifier.registerExecutionProofVerifier.mock.calls).toEqual([
      [2, 2, otherKey],
      [8, 1, otherKey],
    ]);
    expect([...engine.verifiableProofTypes]).toEqual([2, 8]);
    expect([...engine.supportedProofTypes]).toEqual([1, 2, 3, 8]);
  });

  it("refuses a proof type without an assignment", () => {
    expect(() => new NativeProofEngine([{proofType: 8, verificationKey: toHex(vk)}], null)).toThrow(
      "EXECUTION_PROOF_TYPE_UNASSIGNED"
    );
    expect(verifier.registerExecutionProofVerifier).not.toHaveBeenCalled();
  });

  it("refuses a verification key whose digest does not match the assignment", () => {
    const otherKey = toHex(Uint8Array.from([4, 3, 2, 1]));
    expect(() => new NativeProofEngine([{proofType: 2, verificationKey: otherKey}], null)).toThrow(
      "EXECUTION_PROOF_VERIFICATION_KEY_MISMATCH"
    );
    expect(verifier.registerExecutionProofVerifier).not.toHaveBeenCalled();
  });

  it("refuses to start on a platform without the prebuilt verifier", () => {
    verifier.EXECUTION_PROOF_VERIFIER_AVAILABLE = false;
    expect(() => new NativeProofEngine([{proofType: 1, verificationKey: toHex(vk)}], null)).toThrow(
      "EXECUTION_PROOF_VERIFIER_UNAVAILABLE"
    );
    expect(verifier.registerExecutionProofVerifier).not.toHaveBeenCalled();
  });

  it("accepts a proof whose public values are the serialized public input", async () => {
    const engine = new NativeProofEngine([{proofType: 2, verificationKey: toHex(vk)}], null);
    verifier.verifyExecutionProof.mockResolvedValue(ssz.eip8025.PublicInput.serialize(proof.publicInput));

    await expect(engine.verifyExecutionProof(input)).resolves.toBe(true);
    expect(verifier.verifyExecutionProof).toHaveBeenCalledWith(2, proof.proofData);
  });

  it("rejects a proof the verifier does not accept", async () => {
    const engine = new NativeProofEngine([{proofType: 2, verificationKey: toHex(vk)}], null);
    verifier.verifyExecutionProof.mockResolvedValue(null);

    await expect(engine.verifyExecutionProof(input)).resolves.toBe(false);
  });

  it("rejects a valid proof over a different public input", async () => {
    const engine = new NativeProofEngine([{proofType: 2, verificationKey: toHex(vk)}], null);
    const other = {...proof.publicInput, chainId: proof.publicInput.chainId + 1n};
    verifier.verifyExecutionProof.mockResolvedValue(ssz.eip8025.PublicInput.serialize(other));

    await expect(engine.verifyExecutionProof(input)).resolves.toBe(false);
  });

  it("accepts public values matching a later public input candidate and reports its convention", async () => {
    const metrics = createMetricsTest();
    const increment = vi.spyOn(metrics.executionProofEngine.verifyResult, "inc");
    const engine = new NativeProofEngine([{proofType: 2, verificationKey: toHex(vk)}], metrics);
    const other = {...proof.publicInput, newPayloadRequestRoot: Buffer.alloc(32, 8)};
    verifier.verifyExecutionProof.mockResolvedValue(ssz.eip8025.PublicInput.serialize(other));

    await expect(
      engine.verifyExecutionProof({
        proof,
        publicInputs: [
          {convention: "spec", publicInput: proof.publicInput},
          {convention: "execution_specs", publicInput: other},
        ],
      })
    ).resolves.toBe(true);
    expect(increment).toHaveBeenCalledWith({proofType: 2, result: "valid", publicInput: "execution_specs"});
  });

  it("propagates native verifier errors", async () => {
    const engine = new NativeProofEngine([{proofType: 2, verificationKey: toHex(vk)}], null);
    const error = new LodestarError({code: "NATIVE_VERIFIER_FAILED"});
    verifier.verifyExecutionProof.mockRejectedValue(error);

    await expect(engine.verifyExecutionProof(input)).rejects.toBe(error);
  });

  it.each(["valid", "invalid_proof", "public_input_mismatch"])("records %s metrics", async (result) => {
    const metrics = createMetricsTest();
    const timer = vi.fn();
    vi.spyOn(metrics.executionProofEngine.verifyTime, "startTimer").mockReturnValue(timer);
    const increment = vi.spyOn(metrics.executionProofEngine.verifyResult, "inc");
    const engine = new NativeProofEngine([{proofType: 2, verificationKey: toHex(vk)}], metrics);
    verifier.verifyExecutionProof.mockResolvedValue(
      result === "invalid_proof"
        ? null
        : ssz.eip8025.PublicInput.serialize({...proof.publicInput, successfulValidation: result === "valid"})
    );

    await expect(engine.verifyExecutionProof(input)).resolves.toBe(result === "valid");
    expect(increment).toHaveBeenCalledWith({proofType: 2, result, publicInput: result === "valid" ? "spec" : "none"});
    expect(timer).toHaveBeenCalledOnce();
  });

  it("stops the timer when native verification throws", async () => {
    const metrics = createMetricsTest();
    const timer = vi.fn();
    vi.spyOn(metrics.executionProofEngine.verifyTime, "startTimer").mockReturnValue(timer);
    const engine = new NativeProofEngine([{proofType: 2, verificationKey: toHex(vk)}], metrics);
    const error = new LodestarError({code: "NATIVE_VERIFIER_FAILED"});
    verifier.verifyExecutionProof.mockRejectedValue(error);

    await expect(engine.verifyExecutionProof(input)).rejects.toBe(error);
    expect(timer).toHaveBeenCalledOnce();
  });

  it("keeps the 43-byte public input serialization", () => {
    expect(ssz.eip8025.PublicInput.serialize(proof.publicInput)).toHaveLength(43);
  });

  describe("matchesPublicInput", () => {
    it.each([32, 43])("accepts exact and zero-padded public input with %i bytes", (length) => {
      const expected = new Uint8Array(length).fill(3);
      expect(matchesPublicInput(expected, expected)).toBe(true);
      const padded = new Uint8Array(256);
      padded.set(expected);
      expect(matchesPublicInput(padded, expected)).toBe(true);
    });

    it.each([32, 43])("rejects truncated, altered, or non-zero padded public input with %i bytes", (length) => {
      const expected = new Uint8Array(length).fill(3);
      expect(matchesPublicInput(expected.subarray(0, length - 1), expected)).toBe(false);
      const altered = expected.slice();
      altered[0] ^= 1;
      expect(matchesPublicInput(altered, expected)).toBe(false);
      const padded = new Uint8Array(64);
      padded.set(expected);
      padded[63] = 1;
      expect(matchesPublicInput(padded, expected)).toBe(false);
    });
  });
});
