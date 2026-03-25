import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {ExecutionProof} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionProofPool} from "../../../../src/chain/opPools/executionProofPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";

function createProof(overrides: Partial<ExecutionProof> = {}): ExecutionProof {
  return {
    proofData: new Uint8Array(64),
    proofType: 0,
    publicInput: {
      newPayloadRequestRoot: fromHexString("0x" + "cd".repeat(32)),
    },
    ...overrides,
  };
}

describe("ExecutionProofPool", () => {
  it("should add and retrieve a proof by newPayloadRequestRoot", () => {
    const pool = new ExecutionProofPool();
    const proof = createProof();
    const rootHex = toRootHex(proof.publicInput.newPayloadRequestRoot);

    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.size).toBe(1);

    const retrieved = pool.getProofsByNewPayloadRequestRoot(rootHex);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].proofType).toBe(0);
  });

  it("should deduplicate by (newPayloadRequestRoot, proofType)", () => {
    const pool = new ExecutionProofPool();
    const proof = createProof();

    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.add(proof)).toBe(InsertOutcome.AlreadyKnown);
    expect(pool.size).toBe(1);
  });

  it("should store multiple proof types for the same newPayloadRequestRoot", () => {
    const pool = new ExecutionProofPool();
    const root = fromHexString("0x" + "aa".repeat(32));

    for (let proofType = 0; proofType < 3; proofType++) {
      expect(pool.add(createProof({publicInput: {newPayloadRequestRoot: root}, proofType}))).toBe(
        InsertOutcome.NewData
      );
    }

    expect(pool.size).toBe(3);
    const proofs = pool.getProofsByNewPayloadRequestRoot(toRootHex(root));
    expect(proofs).toHaveLength(3);
  });

  it("should store proofs for different newPayloadRequestRoots independently", () => {
    const pool = new ExecutionProofPool();
    const root1 = fromHexString("0x" + "11".repeat(32));
    const root2 = fromHexString("0x" + "22".repeat(32));

    pool.add(createProof({publicInput: {newPayloadRequestRoot: root1}, proofType: 0}));
    pool.add(createProof({publicInput: {newPayloadRequestRoot: root2}, proofType: 0}));

    expect(pool.size).toBe(2);
    expect(pool.getProofsByNewPayloadRequestRoot(toRootHex(root1))).toHaveLength(1);
    expect(pool.getProofsByNewPayloadRequestRoot(toRootHex(root2))).toHaveLength(1);
  });

  it("should reject invalid proofType >= EXECUTION_PROOF_TYPE_COUNT", () => {
    const pool = new ExecutionProofPool();

    expect(pool.add(createProof({proofType: EXECUTION_PROOF_TYPE_COUNT}))).toBe(InsertOutcome.Old);
    expect(pool.add(createProof({proofType: 255}))).toBe(InsertOutcome.Old);
    expect(pool.size).toBe(0);
  });

  it("should return all proofs via getAllProofs", () => {
    const pool = new ExecutionProofPool();
    const root1 = fromHexString("0x" + "11".repeat(32));
    const root2 = fromHexString("0x" + "22".repeat(32));

    pool.add(createProof({publicInput: {newPayloadRequestRoot: root1}, proofType: 0}));
    pool.add(createProof({publicInput: {newPayloadRequestRoot: root1}, proofType: 1}));
    pool.add(createProof({publicInput: {newPayloadRequestRoot: root2}, proofType: 0}));

    expect(pool.getAllProofs()).toHaveLength(3);
  });

  it("should return empty array for unknown newPayloadRequestRoot", () => {
    const pool = new ExecutionProofPool();
    expect(pool.getProofsByNewPayloadRequestRoot("0x" + "00".repeat(32))).toEqual([]);
  });

  describe("hasEnoughProofs", () => {
    it("should return true when enough distinct proof types exist", () => {
      const pool = new ExecutionProofPool();
      const root = fromHexString("0x" + "aa".repeat(32));
      const rootHex = toRootHex(root);

      pool.add(createProof({publicInput: {newPayloadRequestRoot: root}, proofType: 0}));
      pool.add(createProof({publicInput: {newPayloadRequestRoot: root}, proofType: 1}));

      expect(pool.hasEnoughProofs(rootHex, 2)).toBe(true);
      expect(pool.hasEnoughProofs(rootHex, 3)).toBe(false);
    });

    it("should return false for unknown root", () => {
      const pool = new ExecutionProofPool();
      expect(pool.hasEnoughProofs("0x" + "00".repeat(32), 1)).toBe(false);
    });
  });

  describe("has", () => {
    it("should check for specific (newPayloadRequestRoot, proofType)", () => {
      const pool = new ExecutionProofPool();
      const root = fromHexString("0x" + "aa".repeat(32));
      const rootHex = toRootHex(root);

      pool.add(createProof({publicInput: {newPayloadRequestRoot: root}, proofType: 0}));

      expect(pool.has(rootHex, 0)).toBe(true);
      expect(pool.has(rootHex, 1)).toBe(false);
    });

    it("should return false for unknown root", () => {
      const pool = new ExecutionProofPool();
      expect(pool.has("0x" + "00".repeat(32), 0)).toBe(false);
    });
  });

  describe("prune", () => {
    it("should remove a specific root via pruneByRoot", () => {
      const pool = new ExecutionProofPool();
      const root = fromHexString("0x" + "aa".repeat(32));
      const rootHex = toRootHex(root);

      pool.add(createProof({publicInput: {newPayloadRequestRoot: root}, proofType: 0}));
      expect(pool.size).toBe(1);

      pool.pruneByRoot(rootHex);
      expect(pool.size).toBe(0);
      expect(pool.getProofsByNewPayloadRequestRoot(rootHex)).toHaveLength(0);
    });
  });
});
