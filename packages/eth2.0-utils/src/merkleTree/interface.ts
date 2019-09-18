import {Hash, MerkleTree, number64} from "@chainsafe/eth2.0-types";

export interface IProgressiveMerkleTree {

  depth(): number;

  /**
   * push new item into the tree
   */
  push(item: Hash): void;

  add(index: number64, item: Hash): void;

  getProof(index: number64): Hash[];

  /**
   * The merkle root of the tree
   */
  root(): Hash;

  toObject(): MerkleTree;
}
