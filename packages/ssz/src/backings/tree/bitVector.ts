import {TreeBacking} from "@chainsafe/merkle-tree";

import {BitVector} from "../../interface";
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
  getBitOffset(index: number): number {
    return index % 8;
  }
  getChunkOffset(index: number): number {
    return Math.floor((index % 256) / 8);
  }
  getChunkIndex(index: number): number {
    return Math.floor(index / 256);
  }
  getValueAtIndex(target: TreeBacking, index: number): boolean {
    const chunk = target.getRoot(this.gindexOfChunk(target, this.getChunkIndex(index)));
    const byte = chunk[this.getChunkOffset(index)];
    return !!(byte & (1 << this.getBitOffset(index)));
  }
  setProperty(target: TreeBacking, property: number, value: boolean): boolean {
    const chunkGindex = this.gindexOfChunk(target, this.getChunkIndex(property));
    const chunk = target.getRoot(chunkGindex);
    const byteOffset = this.getChunkOffset(property);
    if (value) {
      chunk[byteOffset] |= (1 << this.getBitOffset(property));
    } else {
      chunk[byteOffset] &= (0xff ^ (1 << this.getBitOffset(property)));
    }
    target.setRoot(chunkGindex, chunk);
    return true;
  }
}
