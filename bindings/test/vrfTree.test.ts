import {createHash} from "node:crypto";
import {describe, expect, it} from "vitest";
import {VRF_PROOF_SIZE, VRF_SEED_SIZE, VRF_TREE_DEPTH, VrfTree} from "../src/vrf-tree.js";

function rootOf(proof: Uint8Array, slot: number): Uint8Array {
  let value = proof.subarray(0, 32);
  for (let level = 0; level < VRF_TREE_DEPTH; level++) {
    const sibling = proof.subarray(32 * (level + 1), 32 * (level + 2));
    const pair = Math.floor(slot / 2 ** level) % 2 === 1 ? [sibling, value] : [value, sibling];
    value = createHash("sha256").update(pair[0]).update(pair[1]).digest();
  }
  return value;
}

describe("VrfTree", () => {
  it("proves the leaf of a slot under its root", async () => {
    const tree = await VrfTree.build(new Uint8Array(VRF_SEED_SIZE).fill(5), 17);
    const root = tree.root();
    for (const slot of [0, 1, 65535, 65536, 2 ** 17 - 1]) {
      const proof = tree.proof(slot);
      expect(proof.length).toBe(VRF_PROOF_SIZE);
      expect(rootOf(proof, slot)).toEqual(Buffer.from(root));
    }
    expect(() => tree.proof(2 ** 17)).toThrow("SlotNotPopulated");
  });

  it("rejects malformed arguments", async () => {
    await expect(VrfTree.build(new Uint8Array(31), 17)).rejects.toThrow("InvalidSeedLength");
    await expect(VrfTree.build(new Uint8Array(VRF_SEED_SIZE), VRF_TREE_DEPTH + 1)).rejects.toThrow("InvalidDepth");
    expect(() => new VrfTree().root()).toThrow("TreeNotLoaded");
  });
});
