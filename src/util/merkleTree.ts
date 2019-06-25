/**
 * @module util/merkleTree
 */

import assert from "assert";
import {bytes, bytes32, number64} from "../types";
import {hash} from "./crypto";
import {intDiv} from "./math";
import {serialize} from "@chainsafe/ssz";
import {MerkleTree} from "../types";

export interface IProgressiveMerkleTree {

  depth(): number;

  /**
   * push new item into the tree
   */
  push(item: bytes32): void;

  add(index: number64, item: bytes32): void;

  getProof(index: number64): bytes32[];

  /**
   * The merkle root of the tree
   */
  root(): bytes32;

  serialize(): Buffer;
}

export class ProgressiveMerkleTree implements IProgressiveMerkleTree {
  private readonly _depth: number;
  private readonly _zerohashes: bytes32[];
  private _tree: bytes32[][];
  private _dirty: boolean;

  protected constructor(depth: number, tree: bytes32[][]) {
    assert(depth > 1 && depth <= 52, "tree depth must be between 1 and 53");
    this._depth = depth;
    this._tree = tree;
    this._zerohashes = this.generateZeroHashes();
    this._dirty = false;
  }

  public static empty(depth: number): ProgressiveMerkleTree {
    const tree = Array.from({length: depth + 1}, () => []);
    return new ProgressiveMerkleTree(
      depth,
      tree
    );
  }

  public static fromObject(value: MerkleTree): ProgressiveMerkleTree {
    return new ProgressiveMerkleTree(
      value.depth,
      value.tree
    );
  }

  public depth(): number {
    return this._depth;
  }

  public push(item: bytes32): void {
    this._dirty = true;
    this._tree[0].push(item);
  }

  public add(index: number64, item: bytes32): void {
    this._dirty = true;
    this._tree[0][index] = item;
  }

  public getProof(index: number): bytes32[] {
    if(this._dirty) {
      this.calculateBranches();
    }
    const proof: bytes32[] = [];
    for(let i = 0; i < this._depth; i++) {
      index = index % 2 === 1 ? index - 1 : index + 1;
      if(index < this._tree[i].length) {
        proof.push(this._tree[i][index]);
      } else {
        proof.push(this._zerohashes[i]);
      }
      index = intDiv(index, 2);
    }
    return proof;
  }

  public root(): bytes32 {
    if(this._dirty) {
      this.calculateBranches();
    }
    return this._tree[this._depth][0];
  }

  public serialize(): Buffer {
    return serialize(
      {
        depth: this._depth,
        tree: this._tree,
        zeroHashes: this._zerohashes
      },
      MerkleTree
    );
  }


  private calculateBranches(): void {
    for(let i = 0; i < this._depth; i++) {
      const parent = this._tree[i + 1];
      const child = this._tree[i];
      for(let j = 0; j < child.length; j += 2) {
        const left = child[j];
        const right = (j + 1) < child.length ? child[j + 1] : this._zerohashes[i];
        parent[j / 2] = hash(Buffer.concat([left, right]));
      }
      //unnecessary but makes clearer
      this._tree[i + 1] = parent;
    }
    this._dirty = false;
  }

  private generateZeroHashes(): bytes32[] {
    const zerohashes = Array.from({length: this._depth}, () => Buffer.alloc(32));
    for (let i = 0; i < this._depth - 1; i++) {
      zerohashes[i + 1] =
        hash(Buffer.concat([
          zerohashes[i],
          zerohashes[i],
        ]));
    }
    return zerohashes;
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
