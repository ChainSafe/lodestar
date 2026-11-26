/**
 * A PQ validator's VRF tree: a Merkle tree hashed with Keccak-256 whose leaves are secret values,
 * one per slot. The validator registers its root, and reveals a slot's leaf with its Merkle branch
 * as its RANDAO reveal.
 */

export declare const VRF_SEED_SIZE: 32;
export declare const VRF_TREE_DEPTH: 31;
/** The leaf then one sibling per level, 32 bytes each. */
export declare const VRF_PROOF_SIZE: 1024;

/**
 * A precomputed state of a full tree: its root, 4 zero bytes, then the 31 siblings of its first
 * leaf from the bottom up.
 */
export declare const VRF_STATE_RECORD_SIZE: 1028;

/** Whether the `VRF_PROOF_SIZE`-byte `proof` opens the leaf of `slot` under `root` */
export declare function isValidVrfProof(root: Uint8Array, slot: number, proof: Uint8Array): boolean;

/**
 * Obtain one from `build`: an instance made with `new` holds no tree, and its methods throw
 * `TreeNotLoaded`.
 */
export declare class VrfTree {
  /**
   * The tree of a `VRF_SEED_SIZE`-byte seed, which is all of its secret material. Runs off the JS
   * thread, on `threads` threads or one per CPU. A full tree hashes 2^32 times.
   *
   * Only the leaves of the first `2^populatedDepth` slots are built, and proofs of later slots are
   * refused. What stands above them comes from `records`: precomputed states of
   * `VRF_STATE_RECORD_SIZE` bytes each, one of which must be this seed's, or the promise rejects
   * with `NoMatchingState`. Without `records` the other leaves are zero, which is another tree than
   * the seed's full one: for test networks only.
   */
  static build(seed: Uint8Array, populatedDepth: number, records?: Uint8Array, threads?: number): Promise<VrfTree>;
  /**
   * The tree that `build` gives for the same `seed`, `populatedDepth` and `records`, from the
   * `subtreeRoots()` of one built before. Builds no subtree, so it takes milliseconds.
   *
   * The roots are not checked against the seed: the caller vouches that this seed's tree gave them.
   * With `records`, roots of another tree reject with `NoMatchingState`. Without, they give a tree
   * whose proofs do not open.
   */
  static fromSubtreeRoots(
    seed: Uint8Array,
    populatedDepth: number,
    subtreeRoots: Uint8Array,
    records?: Uint8Array
  ): Promise<VrfTree>;
  /** The roots of the subtrees with a populated leaf, 32 bytes each: inner nodes, which hold no secret. */
  subtreeRoots(): Uint8Array;
  root(): Uint8Array;
  /**
   * The `VRF_PROOF_SIZE`-byte proof for `slot`. Throws `SlotNotPopulated` past the populated slots.
   * A slot outside the 2^16 around the last one proved rebuilds that part of the tree first.
   */
  proof(slot: number): Uint8Array;
}
