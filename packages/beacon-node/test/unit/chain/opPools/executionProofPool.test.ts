import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {EXECUTION_PROOF_TYPE_COUNT} from "@lodestar/params";
import {ExecutionProof} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionProofPool} from "../../../../src/chain/opPools/executionProofPool.js";
import {InsertOutcome} from "../../../../src/chain/opPools/types.js";

function createProof(overrides: Partial<ExecutionProof> = {}): ExecutionProof {
  return {
    proofId: 0,
    slot: 10,
    blockHash: fromHexString("0x" + "ab".repeat(32)),
    blockRoot: fromHexString("0x" + "cd".repeat(32)),
    proofData: new Uint8Array(64),
    ...overrides,
  };
}

describe("ExecutionProofPool", () => {
  it("should add and retrieve a proof by block root", () => {
    const pool = new ExecutionProofPool();
    const proof = createProof();
    const blockRootHex = toRootHex(proof.blockRoot);

    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.size).toBe(1);

    const retrieved = pool.getProofsByBlockRoot(blockRootHex);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].proofId).toBe(0);
    expect(retrieved[0].slot).toBe(10);
  });

  it("should deduplicate by (blockRoot, proofId)", () => {
    const pool = new ExecutionProofPool();
    const proof = createProof();

    expect(pool.add(proof)).toBe(InsertOutcome.NewData);
    expect(pool.add(proof)).toBe(InsertOutcome.AlreadyKnown);
    expect(pool.size).toBe(1);
  });

  it("should store multiple proof types for the same block", () => {
    const pool = new ExecutionProofPool();
    const blockRoot = fromHexString("0x" + "aa".repeat(32));

    for (let proofId = 0; proofId < 3; proofId++) {
      expect(pool.add(createProof({blockRoot, proofId}))).toBe(InsertOutcome.NewData);
    }

    expect(pool.size).toBe(3);
    const proofs = pool.getProofsByBlockRoot(toRootHex(blockRoot));
    expect(proofs).toHaveLength(3);
  });

  it("should store proofs for different blocks independently", () => {
    const pool = new ExecutionProofPool();
    const root1 = fromHexString("0x" + "11".repeat(32));
    const root2 = fromHexString("0x" + "22".repeat(32));

    pool.add(createProof({blockRoot: root1, proofId: 0}));
    pool.add(createProof({blockRoot: root2, proofId: 0}));

    expect(pool.size).toBe(2);
    expect(pool.getProofsByBlockRoot(toRootHex(root1))).toHaveLength(1);
    expect(pool.getProofsByBlockRoot(toRootHex(root2))).toHaveLength(1);
  });

  it("should reject proofs older than lowestPermissibleSlot", () => {
    const pool = new ExecutionProofPool();

    // Add a proof at slot 20
    pool.add(createProof({slot: 20}));
    // Prune at slot 30 (retains 8 slots → cutoff = 22)
    pool.prune(30);

    // Slot 10 is below cutoff
    expect(pool.add(createProof({slot: 10, blockRoot: fromHexString("0x" + "ff".repeat(32))}))).toBe(InsertOutcome.Old);
  });

  it("should reject far-future proofs when clockSlot is provided", () => {
    const pool = new ExecutionProofPool();
    const clockSlot = 100;

    // Proof at slot 200 is far in the future (> clockSlot + 8)
    expect(pool.add(createProof({slot: 200}), clockSlot)).toBe(InsertOutcome.Old);

    // Proof at slot 105 is within the window (≤ clockSlot + 8)
    expect(pool.add(createProof({slot: 105}), clockSlot)).toBe(InsertOutcome.NewData);
  });

  it("should reject invalid proofId >= EXECUTION_PROOF_TYPE_COUNT", () => {
    const pool = new ExecutionProofPool();

    expect(pool.add(createProof({proofId: EXECUTION_PROOF_TYPE_COUNT}))).toBe(InsertOutcome.Old);
    expect(pool.add(createProof({proofId: 255}))).toBe(InsertOutcome.Old);
    expect(pool.size).toBe(0);
  });

  it("should return proofs by range", () => {
    const pool = new ExecutionProofPool();

    for (let slot = 10; slot < 15; slot++) {
      pool.add(createProof({slot, blockRoot: fromHexString("0x" + slot.toString(16).padStart(64, "0"))}));
    }

    const proofs = pool.getProofsByRange(10, 5);
    expect(proofs).toHaveLength(5);

    // Subset: only slots 12-13
    const subset = pool.getProofsByRange(12, 2);
    expect(subset).toHaveLength(2);
    expect(subset.every((p) => p.slot >= 12 && p.slot < 14)).toBe(true);
  });

  it("should return empty array for unknown block root", () => {
    const pool = new ExecutionProofPool();
    expect(pool.getProofsByBlockRoot("0x" + "00".repeat(32))).toEqual([]);
  });

  describe("hasEnoughProofs", () => {
    it("should return true when enough distinct proof types exist", () => {
      const pool = new ExecutionProofPool();
      const blockRoot = fromHexString("0x" + "aa".repeat(32));
      const blockRootHex = toRootHex(blockRoot);

      pool.add(createProof({blockRoot, proofId: 0}));
      pool.add(createProof({blockRoot, proofId: 1}));

      expect(pool.hasEnoughProofs(blockRootHex, 2)).toBe(true);
      expect(pool.hasEnoughProofs(blockRootHex, 3)).toBe(false);
    });

    it("should return false for unknown block root", () => {
      const pool = new ExecutionProofPool();
      expect(pool.hasEnoughProofs("0x" + "00".repeat(32), 1)).toBe(false);
    });
  });

  describe("has", () => {
    it("should check for specific (blockRoot, proofId)", () => {
      const pool = new ExecutionProofPool();
      const blockRoot = fromHexString("0x" + "aa".repeat(32));
      const blockRootHex = toRootHex(blockRoot);

      pool.add(createProof({blockRoot, proofId: 0}));

      expect(pool.has(blockRootHex, 0)).toBe(true);
      expect(pool.has(blockRootHex, 1)).toBe(false);
    });

    it("should return false for unknown block root", () => {
      const pool = new ExecutionProofPool();
      expect(pool.has("0x" + "00".repeat(32), 0)).toBe(false);
    });
  });

  describe("prune", () => {
    it("should remove oldest proofs beyond retention window", () => {
      const pool = new ExecutionProofPool();

      // Add proofs at 10 slots (10-19), exceeding SLOTS_RETAINED=8
      for (let slot = 10; slot < 20; slot++) {
        pool.add(createProof({slot, blockRoot: fromHexString("0x" + slot.toString(16).padStart(64, "0"))}));
      }
      expect(pool.size).toBe(10);

      // Prune keeps newest 8 slots by count: 12-19 survive, 10-11 pruned
      pool.prune(25);

      // Slots 10-11 should be pruned (oldest 2 beyond retention count)
      expect(pool.getProofsByRange(10, 2)).toHaveLength(0);
      // Slots 12-19 should remain (newest 8)
      expect(pool.getProofsByRange(12, 8)).toHaveLength(8);
    });

    it("should clean up reverse index during prune", () => {
      const pool = new ExecutionProofPool();
      const oldBlockRoot = fromHexString("0x" + "aa".repeat(32));

      pool.add(createProof({slot: 5, blockRoot: oldBlockRoot}));
      pool.prune(20);

      // Reverse index should be cleaned
      expect(pool.getProofsByBlockRoot(toRootHex(oldBlockRoot))).toHaveLength(0);
      expect(pool.has(toRootHex(oldBlockRoot), 0)).toBe(false);
    });
  });
});
