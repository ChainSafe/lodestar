import {describe, expect, it} from "vitest";
import {VRF_PROOF_SIZE, VRF_SEED_SIZE, VRF_TREE_DEPTH, VrfTree, isValidVrfProof} from "../src/vrf-tree.js";

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

  it("rejects malformed arguments", async () => {
    await expect(VrfTree.build(new Uint8Array(31), 17)).rejects.toThrow("InvalidSeedLength");
    await expect(VrfTree.build(new Uint8Array(VRF_SEED_SIZE), VRF_TREE_DEPTH + 1)).rejects.toThrow("InvalidDepth");
    expect(() => new VrfTree().root()).toThrow("TreeNotLoaded");
  });
});
