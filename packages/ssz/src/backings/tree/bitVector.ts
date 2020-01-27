import {BitVector} from "../../interface";
import {TreeBacking, LeafNode} from "@chainsafe/merkle-tree";

import {BitVectorType} from "../../types";
import {BasicVectorTreeHandler} from "./vector";
import {TreeBackedValue} from "./abstract";

export class BitVectorTreeHandler extends BasicVectorTreeHandler<BitVector> {
  _type: BitVectorType;
  constructor(type: BitVectorType) {
    super(type);
    this._type = type;
  }
  getByteLength(target: TreeBacking): number {
    return Math.ceil(this.getLength(target) / 8);
  }
  size(target: TreeBacking): number {
    return this.getByteLength(target);
  }
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<BitVector> {
    // mask last byte to ensure it doesn't go over length
    const lastByte = data[end - 1];
    const mask = (0xff << this._type.length % 8) & 0xff;
    if (lastByte & mask) {
      throw new Error("Invalid deserialized bitvector length");
    }
    const target = super.fromBytes(data, start, end).backing();
    return this.createBackedValue(target);
  }
}
