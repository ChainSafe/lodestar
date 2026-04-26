import {describe, expect, it} from "vitest";
import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {SignedExecutionProof} from "@lodestar/types";
import {ExecutionProofPool} from "../../../../src/chain/opPools/executionProofPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";

const ROOT_A = Uint8Array.from({length: 32}, () => 0xaa);
const ROOT_B = Uint8Array.from({length: 32}, () => 0xbb);

function createSignedProof(
  overrides: {newPayloadRequestRoot?: Uint8Array; proofType?: number; validatorIndex?: number} = {}
): SignedExecutionProof {
  return {
    message: {
      proofData: new Uint8Array(64),
      proofType: overrides.proofType ?? 0,
      publicInput: {
        newPayloadRequestRoot: overrides.newPayloadRequestRoot ?? ROOT_A,
      },
    },
    validatorIndex: overrides.validatorIndex ?? 0,
    signature: new Uint8Array(96),
  };
}

describe("ExecutionProofPool", () => {
  it("should add and retrieve a proof by request root", () => {
    const pool = new ExecutionProofPool();
    const proof = createSignedProof();
    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.size).toBe(1);
    const retrieved = pool.getByRequestRoot(ROOT_A);
    expect(retrieved).toHaveLength(1);
  });

  it("should deduplicate by (requestRoot, proofType)", () => {
    const pool = new ExecutionProofPool();
    const proof = createSignedProof();
    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.add(proof)).toBe(InsertOutcome.AlreadyKnown);
    expect(pool.size).toBe(1);
  });

  it("should store multiple proof types for the same request root", () => {
    const pool = new ExecutionProofPool();
    for (let proofType = 0; proofType < 3; proofType++) {
      expect(pool.add(createSignedProof({proofType}))).toBe(InsertOutcome.NewData);
    }
    expect(pool.size).toBe(3);
    expect(pool.getByRequestRoot(ROOT_A)).toHaveLength(3);
  });

  it("should store proofs for different request roots independently", () => {
    const pool = new ExecutionProofPool();
    pool.add(createSignedProof({newPayloadRequestRoot: ROOT_A}));
    pool.add(createSignedProof({newPayloadRequestRoot: ROOT_B}));
    expect(pool.size).toBe(2);
    expect(pool.getByRequestRoot(ROOT_A)).toHaveLength(1);
    expect(pool.getByRequestRoot(ROOT_B)).toHaveLength(1);
  });

  it("should reject invalid proofType >= EXECUTION_PROOF_TYPE_COUNT", () => {
    const pool = new ExecutionProofPool();
    expect(pool.add(createSignedProof({proofType: EXECUTION_PROOF_TYPE_COUNT}))).toBe(InsertOutcome.Old);
    expect(pool.size).toBe(0);
  });

  it("should return empty for unknown request root", () => {
    const pool = new ExecutionProofPool();
    expect(pool.getByRequestRoot(ROOT_A)).toEqual([]);
  });

  describe("hasEnoughProofs", () => {
    it("should return true when enough distinct proof types exist", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({proofType: 0}));
      pool.add(createSignedProof({proofType: 1}));
      expect(pool.hasEnoughProofs(ROOT_A, 2)).toBe(true);
      expect(pool.hasEnoughProofs(ROOT_A, 3)).toBe(false);
    });
  });

  describe("has", () => {
    it("should check for specific (requestRoot, proofType)", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({proofType: 0}));
      expect(pool.has(ROOT_A, 0)).toBe(true);
      expect(pool.has(ROOT_A, 1)).toBe(false);
    });
  });

  describe("getAll", () => {
    it("should return all proofs across all request roots", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_A, proofType: 0}));
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_B, proofType: 0}));
      expect(pool.getAll()).toHaveLength(2);
    });
  });

  describe("prune", () => {
    it("should remove proofs for specified request roots", () => {
      const pool = new ExecutionProofPool();
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_A}));
      pool.add(createSignedProof({newPayloadRequestRoot: ROOT_B}));
      pool.pruneByRequestRoots(new Set([ROOT_A]));
      expect(pool.getByRequestRoot(ROOT_A)).toEqual([]);
      expect(pool.getByRequestRoot(ROOT_B)).toHaveLength(1);
    });
  });
});
