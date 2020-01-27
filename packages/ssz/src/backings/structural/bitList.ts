import {BitList} from "../../interface";
import {BitListType} from "../../types";
import {BasicListStructuralHandler} from "./list";

export class BitListStructuralHandler extends BasicListStructuralHandler<BitList> {
  _type: BitListType;
  constructor(type: BitListType) {
    super(type);
    this._type = type;
  }
  getByte(value: BitList, index: number): number {
    const firstBitIndex = index * 8;
    const lastBitIndex = Math.min(firstBitIndex + 7, value.length - 1);
    let bitstring = "0b";
    for (let i = lastBitIndex; i >= firstBitIndex; i--) {
      bitstring += value[i] ? "1" : "0";
    }
    return Number(bitstring);
  }
  getLength(value: BitList): number {
    return value.length;
  }
  getByteLength(value: BitList): number {
    return Math.ceil(value.length / 8);
  }
  size(value: BitList): number {
    if (value.length % 8 === 0) {
      return this.getByteLength(value) + 1;
    } else {
      return this.getByteLength(value);
    }
  }
  fromBytes(data: Uint8Array, start: number, end: number): BitList {
    const value = [];
    const toBool = (c: string): boolean => c === "1" ? true : false;
    for (let i = start; i < end-1; i++) {
      let bitstring = data[i].toString(2);
      bitstring = "0".repeat(8 - bitstring.length) + bitstring;
      value.push(...Array.prototype.map.call(bitstring, toBool).reverse());
    }
    const lastByte = data[end-1];
    if (lastByte === 0) {
      throw new Error("Invalid deserialized bitlist, padding bit required");
    }
    if (lastByte === 1) {
      return value as BitList;
    }
    const lastBits = Array.prototype.map.call(lastByte.toString(2), toBool).reverse();
    const last1 = lastBits.lastIndexOf(true);
    value.push(...lastBits.slice(0, last1));
    if (value.length > this._type.limit) {
      throw new Error("Invalid deserialized bitlist, length greater than limit");
    }
    return value as BitList;
  }
  toBytes(value: BitList, output: Uint8Array, offset: number): number {
    const byteLength = this.getByteLength(value);
    for (let i = 0; i < byteLength; i++) {
      output[offset + i] = this.getByte(value, i);
    }
    const newOffset = offset + byteLength;
    if (value.length % 8 === 0) {
      output[newOffset] = 1;
      return newOffset + 1;
    } else {
      output[newOffset - 1] |= 1 << (value.length % 8);
      return newOffset;
    }
  }
  chunk(value: BitList, index: number): Uint8Array {
    const output = new Uint8Array(32);
    const byteLength = Math.min(32, this.getByteLength(value) - index);
    for (let i = 0; i < byteLength; i++) {
      output[i] = this.getByte(value, i + index);
    }
    return output;
  }
}
