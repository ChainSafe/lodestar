import {MerkleTree, Number64, Bytes32, Root} from "@chainsafe/eth2.0-types";

export interface IProgressiveMerkleTree {

  depth(): number;

  /**
   * push new item into the tree
   */
  push(item: Bytes32): void;

  add(index: Number64, item: Bytes32): void;

  getProof(index: Number64): Bytes32[];

  /**
   * The merkle root of the tree
   */
  root(): Root;

  toObject(): MerkleTree;
}
