/**
 * A PQ validator's VRF tree: a Merkle tree whose leaves are secret values, one per slot. The
 * validator registers its root, and reveals a slot's leaf with its Merkle branch as its RANDAO
 * reveal or its aggregator selection proof.
 */

export declare const VRF_SEED_SIZE: 32;
export declare const VRF_TREE_DEPTH: 31;
/** The leaf then one sibling per level, 32 bytes each. */
export declare const VRF_PROOF_SIZE: 1024;

/**
 * Obtain one from `build`: an instance made with `new` holds no tree, and its methods throw
 * `TreeNotLoaded`.
 */
export declare class VrfTree {
  /**
   * The tree of a `VRF_SEED_SIZE`-byte seed, which is all of its secret material. Runs off the JS
   * thread, on every CPU. A full tree hashes 2^32 times.
   *
   * Slots from `2^populatedDepth` on get no secret, so their proofs are refused. Anything below
   * `VRF_TREE_DEPTH` is for test networks only.
   */
  static build(seed: Uint8Array, populatedDepth: number): Promise<VrfTree>;
  root(): Uint8Array;
  /**
   * The `VRF_PROOF_SIZE`-byte proof for `slot`. Throws `SlotNotPopulated` past the populated slots.
   * A slot outside the 2^16 around the last one proved rebuilds that part of the tree first.
   */
  proof(slot: number): Uint8Array;
}
