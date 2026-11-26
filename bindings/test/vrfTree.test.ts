import {describe, expect, it} from "vitest";
import {
  VRF_PROOF_SIZE,
  VRF_SEED_SIZE,
  VRF_STATE_RECORD_SIZE,
  VRF_TREE_DEPTH,
  VrfTree,
  isValidVrfProof,
} from "../src/vrf-tree.js";

describe("VrfTree", () => {
  it("proves the leaf of a slot under its root", async () => {
    const tree = await VrfTree.build(new Uint8Array(VRF_SEED_SIZE).fill(5), 17);
    const root = tree.root();
    for (const slot of [0, 1, 65535, 65536, 2 ** 17 - 1]) {
      const proof = tree.proof(slot);
      expect(proof.length).toBe(VRF_PROOF_SIZE);
      expect(isValidVrfProof(root, slot, proof)).toBe(true);
      expect(isValidVrfProof(root, slot ^ 1, proof)).toBe(false);
      expect(isValidVrfProof(root, slot, proof.subarray(32))).toBe(false);
    }
    expect(() => tree.proof(2 ** 17)).toThrow("SlotNotPopulated");
  });

  it("takes what stands above its first slots from a precomputed state", async () => {
    const seed = new Uint8Array(VRF_SEED_SIZE).fill(6);
    // The whole of a shallow tree stands in for a full one, which takes minutes
    const full = await VrfTree.build(seed, 18);
    const records = new Uint8Array(2 * VRF_STATE_RECORD_SIZE);
    records.set(full.root(), VRF_STATE_RECORD_SIZE);
    records.set(full.proof(0).subarray(32), VRF_STATE_RECORD_SIZE + 36);

    const partial = await VrfTree.build(seed, 17, records);
    expect(partial.root()).toEqual(full.root());
    expect(partial.proof(70_000)).toEqual(full.proof(70_000));
    expect(() => partial.proof(2 ** 17)).toThrow("SlotNotPopulated");

    await expect(VrfTree.build(seed, 17, records.subarray(0, VRF_STATE_RECORD_SIZE))).rejects.toThrow(
      "NoMatchingState"
    );
  });

  it("comes back from its subtree roots as the tree that was built", async () => {
    const seed = new Uint8Array(VRF_SEED_SIZE).fill(6);
    const full = await VrfTree.build(seed, 18);
    const records = new Uint8Array(VRF_STATE_RECORD_SIZE);
    records.set(full.root(), 0);
    records.set(full.proof(0).subarray(32), 36);

    const built = await VrfTree.build(seed, 17, records);
    const subtreeRoots = built.subtreeRoots();
    expect(subtreeRoots.length).toBe(2 * 32);

    const loaded = await VrfTree.fromSubtreeRoots(seed, 17, subtreeRoots, records);
    expect(loaded.root()).toEqual(built.root());
    expect(loaded.proof(70_000)).toEqual(built.proof(70_000));
    expect(loaded.subtreeRoots()).toEqual(subtreeRoots);

    const withoutRecords = await VrfTree.fromSubtreeRoots(seed, 17, (await VrfTree.build(seed, 17)).subtreeRoots());
    expect(withoutRecords.root()).toEqual((await VrfTree.build(seed, 17)).root());

    const other = await VrfTree.build(new Uint8Array(VRF_SEED_SIZE).fill(7), 17);
    await expect(VrfTree.fromSubtreeRoots(seed, 17, other.subtreeRoots(), records)).rejects.toThrow("NoMatchingState");
    await expect(VrfTree.fromSubtreeRoots(seed, 17, subtreeRoots.subarray(0, 32), records)).rejects.toThrow(
      "InvalidSubtreeRoots"
    );
    await expect(VrfTree.fromSubtreeRoots(seed, 17, subtreeRoots.subarray(0, 33))).rejects.toThrow(
      "InvalidSubtreeRoots"
    );
    await expect(VrfTree.fromSubtreeRoots(seed, 17, new Uint8Array(0))).rejects.toThrow("InvalidSubtreeRoots");
    expect(() => new VrfTree().subtreeRoots()).toThrow("TreeNotLoaded");
  });

  it("rejects malformed arguments", async () => {
    await expect(VrfTree.build(new Uint8Array(31), 17)).rejects.toThrow("InvalidSeedLength");
    await expect(VrfTree.build(new Uint8Array(VRF_SEED_SIZE), VRF_TREE_DEPTH + 1)).rejects.toThrow("InvalidDepth");
    expect(() => new VrfTree().root()).toThrow("TreeNotLoaded");
  });
});
