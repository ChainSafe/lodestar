import {Tree} from "@chainsafe/persistent-merkle-tree";

import {BitList} from "../../interface";
import {BitListType} from "../../types";
import {BasicListTreeHandler} from "./list";

export class BitListTreeHandler extends BasicListTreeHandler<BitList> {
  _type: BitListType;
  constructor(type: BitListType) {
    super(type);
    this._type = type;
  }
  getByteLength(target: Tree): number {
    return Math.ceil(this.getLength(target) / 8);
  }
  size(target: Tree): number {
    const bitLength = this.getLength(target);
    if (bitLength % 8 === 0) {
      return this.getByteLength(target) + 1;
    } else {
      return this.getByteLength(target);
    }
  }
  fromBytes(data: Uint8Array, start: number, end: number): Tree {
    const lastByte = data[end - 1];
    if (lastByte === 0) {
      throw new Error("Invalid deserialized bitlist, padding bit required");
    }
    const target = super.fromBytes(data, start, end);
    const lastGindex = this.gindexOfChunk(target, Math.ceil((end - start) / 32) - 1);
    // mutate lastChunk (instead of copying/creating a new chunk)
    // this is ok only because we haven't cached hashes yet
    const lastChunk = target.getRoot(lastGindex);
    const lastChunkByte = ((end - start) % 32) - 1;
    let length;
    if (lastByte === 1) { // zero lastChunkByte
      length = (end - start - 1) * 8;
      lastChunk[lastChunkByte] = 0;
    } else { // mask lastChunkByte
      const lastByteBitLength = lastByte.toString(2).length - 1;
      length = (end - start - 1) * 8 + lastByteBitLength;
      const mask = 0xff >> (8 - lastByteBitLength);
      lastChunk[lastChunkByte] &= mask;
    }
    this.setLength(target, length);
    return target;
  }
  toBytes(target: Tree, output: Uint8Array, offset: number): number {
    const newOffset = super.toBytes(target, output, offset);
    const bitLength = this.getLength(target);
    const size = this.size(target);
    // set padding bit
    output[offset + size - 1] |= 1 << (bitLength  % 8);
    return newOffset;
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
  getValueAtIndex(target: Tree, index: number): boolean {
    const chunk = this.getRootAtChunk(target, this.getChunkIndex(index));
    const byte = chunk[this.getChunkOffset(index)];
    return !!(byte & (1 << this.getBitOffset(index)));
  }
  setProperty(target: Tree, property: number, value: boolean, expand=false): boolean {
    const chunkGindex = this.gindexOfChunk(target, this.getChunkIndex(property));
    const chunk = target.getRoot(chunkGindex);
    const byteOffset = this.getChunkOffset(property);
    if (value) {
      chunk[byteOffset] |= (1 << this.getBitOffset(property));
    } else {
      chunk[byteOffset] &= (0xff ^ (1 <<  this.getBitOffset(property)));
    }
    target.setRoot(chunkGindex, chunk, expand);
    return true;
  }
}
