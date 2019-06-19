/**
 * @module util/merkleTree
 */

import assert from "assert";
import {bytes32} from "../types";
import {hash} from "./crypto";
import {intDiv} from "./math";
import {serialize} from "@chainsafe/ssz";
import {MerkleTree} from "../types";

export interface IProgressiveMerkleTree {
  /**
   * The number of items in the tree
   */
  count(): number;
  depth(): number;
  /**
   * Add a new item into the tree
   *
   * Return a proof to verify the item is in the tree
   * @returns proof
   */
  push(item: bytes32): bytes32[];
  /**
   * The merkle root of the tree
   */
  root(): bytes32;

  serialize(): Buffer;
}

export class ProgressiveMerkleTree implements IProgressiveMerkleTree {
  private _depth: number;
  private _count: number;
  private _branch: bytes32[];
  private _zerohashes: bytes32[];

  protected constructor(depth: number, count: number, branch: bytes32[], zeroHashes: bytes32[]) {
    assert(depth <= 52, "tree depth must be less than 53");
    this._depth = depth;
    this._count = count;
    this._branch = branch;
    this._zerohashes = zeroHashes;
  }

  public static empty(depth: number): ProgressiveMerkleTree {
    const branch = Array.from({length: depth}, () => Buffer.alloc(32));
    const zerohashes = Array.from({length: depth}, () => Buffer.alloc(32));
    for (let i = 0; i < depth - 1; i++) {
      zerohashes[i + 1] = branch[i + 1] =
        hash(Buffer.concat([
          zerohashes[i],
          zerohashes[i],
        ]));
    }
    return new ProgressiveMerkleTree(
      depth,
      0,
      branch,
      zerohashes
    );
  }

  public static fromObject(value: MerkleTree) {
    return new ProgressiveMerkleTree(
      value.depth,
      value.count,
      value.branch,
      value.zeroHashes
    );
  }


  public count(): number {
    return this._count;
  }

  public depth(): number {
    return this._depth;
  }

  public push(item: bytes32): bytes32[] {
    const depth = this._depth;
    const proof = this._proof();
    this._count++;
    let i = 0;
    let powerOfTwo = 2;
    for (let j = 0; j < depth; j++) {
      if (this._count % powerOfTwo !== 0) {
        break;
      }
      i++;
      powerOfTwo *= 2;
    }

    let value = item;
    for (let j = 0; j < depth; j++) {
      if (j < i) {
        value = hash(Buffer.concat([
          this._branch[j],
          value,
        ]));
      } else {
        break;
      }
    }
    this._branch[i] = value;
    return proof;
  }

  public clone(): ProgressiveMerkleTree {
    const cloned: ProgressiveMerkleTree = Object.create(ProgressiveMerkleTree.prototype);
    cloned._depth = this._depth;
    cloned._count = this._count;
    cloned._branch = this._branch.slice();
    cloned._zerohashes = this._zerohashes;
    return cloned;
  }

  public root(): bytes32 {
    let root = Buffer.alloc(32);
    let size = this._count;
    for (let i = 0; i < this._depth; i++) {
      if (size % 2 === 1) {
        root = hash(Buffer.concat([
          this._branch[i],
          root,
        ]));
      } else {
        root = hash(Buffer.concat([
          root,
          this._zerohashes[i],
        ]));
      }
      size = intDiv(size, 2);
    }
    return root;
  }

  public serialize(): Buffer {
    return serialize(
      {
        count: this._count,
        depth: this._depth,
        branch: this._branch,
        zeroHashes: this._zerohashes
      },
      MerkleTree
    );
  }

  private _proof(): bytes32[] {
    let size = this._count;
    let proof = this._branch.slice();
    for (let i = 0; i < this._depth; i++) {
      if (size % 2 === 0) {
        proof[i] = this._zerohashes[i];
      }
      size = intDiv(size, 2);
    }
    return proof;
  }

}

/**
 * Verify that the given ``leaf`` is on the merkle branch ``proof``
 * starting with the given ``root``.
 */
export function verifyMerkleBranch(
  leaf: bytes32,
  proof: bytes32[],
  depth: number,
  index: number,
  root: bytes32,
): boolean {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    if (intDiv(index, 2**i) % 2) {
      value = hash(Buffer.concat([proof[i], value]));
    } else {
      value = hash(Buffer.concat([value, proof[i]]));
    }
  }
  return value.equals(root);
}
