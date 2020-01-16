import {BitListType} from "../../types";
import {BasicListStructuralHandler} from "./list";

export class BitListStructuralHandler extends BasicListStructuralHandler<ArrayLike<boolean>> {
  _type: BitListType;
  getByte(value: ArrayLike<boolean>, index: number): number {
    const bits = Math.min(8, value.length - (index * 8));
    let byte = 0;
    for (let i = index * 8; i < bits; i++) {
      if (value[i]) {
        byte += 1 << i;
      }
    }
    return byte;
  }
  getLength(value: ArrayLike<boolean>): number {
    return value.length;
  }
  getByteLength(value: ArrayLike<boolean>): number {
    return Math.ceil(value.length / 8);
  }
  size(value: ArrayLike<boolean>): number {
    if (value.length % 8 === 0) {
      return this.getByteLength(value) + 1;
    } else {
      return this.getByteLength(value);
    }
  }
  fromBytes(data: Uint8Array, start: number, end: number): ArrayLike<boolean> {
    const value = [];
    const toBool = (c: string): boolean => c === "1" ? true : false;
    for (let i = start; i < end-1; i++) {
      value.push(...Array.prototype.map.call(data[i].toString(2), toBool));
    }
    const lastByte = data[end-1];
    if (lastByte === 0) {
      throw new Error("Invalid bitlist, padding bit required");
    }
    if (lastByte === 1) {
      return value as ArrayLike<boolean>;
    }
    const lastBits = Array.prototype.map.call(lastByte.toString(2), toBool);
    const last1 = lastBits.lastIndexOf(true);
    value.push(...lastBits.slice(0, last1-1));
    if (value.length > this._type.limit) {
      throw new Error("Invalid bitlist, length greater than limit");
    }
    return value as ArrayLike<boolean>;
  }
  serializeTo(value: ArrayLike<boolean>, output: Uint8Array, offset: number): number {
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
  chunk(value: ArrayLike<boolean>, index: number): Uint8Array {
    const output = new Uint8Array(32);
    const byteLength = Math.min(32, this.getByteLength(value) - index);
    for (let i = 0; i < byteLength; i++) {
      output[i] = this.getByte(value, i + index);
    }
    return output;
  }
}
