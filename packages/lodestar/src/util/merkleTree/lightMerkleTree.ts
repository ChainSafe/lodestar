import {Hash} from "@chainsafe/eth2.0-types";
import {hash} from "../crypto";
import {intDiv} from "../math";
import assert from "assert";

/**
 * Only usable if we need proof and root of adding single element.
 * Element proof gets invalid if you add another element.
 */
export class LightProgressiveMerkleTree {
  private _depth: number;
  private _count: number;
  private _branch: Hash[];
  private _zerohashes: Hash[];

  public constructor(depth: number) {
    assert(depth <= 52, "tree depth must be less than 53");
    this._depth = depth;
    this._count = 0;
    this._branch = Array.from({length: depth}, () => Buffer.alloc(32));
    this._zerohashes = Array.from({length: depth}, () => Buffer.alloc(32));
    for (let i = 0; i < depth - 1; i++) {
      this._zerohashes[i + 1] = this._branch[i + 1] =
        hash(Buffer.concat([
          this._zerohashes[i],
          this._zerohashes[i],
        ]));
    }
  }

  public count(): number {
    return this._count;
  }

  public depth(): number {
    return this._depth;
  }

  public push(item: Hash): Hash[] {
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

  public clone(): LightProgressiveMerkleTree {
    const cloned: LightProgressiveMerkleTree = Object.create(LightProgressiveMerkleTree.prototype);
    cloned._depth = this._depth;
    cloned._count = this._count;
    cloned._branch = this._branch.slice();
    cloned._zerohashes = this._zerohashes;
    return cloned;
  }

  public root(): Hash {
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

  private _proof(): Hash[] {
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
