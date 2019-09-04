/**
 * @module util/merkleTree
 */

import assert from "assert";
import {MerkleTree, Hash, number64} from "@chainsafe/eth2.0-types";
import {hash} from "../crypto";
import {intDiv} from "../math";
import {serialize, deserialize, SimpleContainerType} from "@chainsafe/ssz";
import {IProgressiveMerkleTree} from "./interface";

const MerkleTreeType: SimpleContainerType = {
  fields: [
    ["depth", "number64"],
    ["tree", {
      elementType: {
        elementType: {
          elementType: "byte",
          maxLength: 32,
        },
        maxLength: 32,
      },
      maxLength: 32,
    }],
  ],
};

export class ProgressiveMerkleTree implements IProgressiveMerkleTree {
  private readonly _depth: number;
  private readonly _zerohashes: Hash[];
  private _tree: Hash[][];
  private _dirty: boolean;

  public constructor(depth: number, tree: Hash[][]) {
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

  public depth(): number {
    return this._depth;
  }

  public push(item: Hash): void {
    this._dirty = true;
    this._tree[0].push(item);
  }

  public add(index: number64, item: Hash): void {
    this._dirty = true;
    this._tree[0][index] = item;
  }

  public getProof(index: number): Hash[] {
    this.calculateBranchesIfNecessary();
    const proof: Hash[] = [];
    for(let i = 0; i < this._depth; i++) {
      index = index % 2 === 1 ? index - 1 : index + 1;
      if(index < this._tree[i].length) {
        proof.push(this._tree[i][index]);
      } else {
        proof.push(this._zerohashes[i]);
      }
      index = intDiv(index, 2);
    }
    proof.push(serialize(this._tree[0].length, "uint256"));
    return proof;
  }

  private calculateBranchesIfNecessary() {
    if (this._dirty) {
      this.calculateBranches();
    }
  }

  public root(): Hash {
    this.calculateBranchesIfNecessary();
    return this._tree[this._depth][0];
  }

  public static deserialize(data: Buffer): ProgressiveMerkleTree {
    const value = deserialize(data, MerkleTreeType);
    return new ProgressiveMerkleTree(
      value.depth,
      value.tree
    );
  }

  public toObject(): MerkleTree {
    return {
      depth: this._depth,
      tree: this._tree
    };
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

  private generateZeroHashes(): Hash[] {
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

