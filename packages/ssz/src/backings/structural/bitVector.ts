import {BitVectorType} from "../../types";
import {BasicVectorStructuralHandler} from "./vector";

export class BitVectorStructuralHandler extends BasicVectorStructuralHandler<ArrayLike<boolean>> {
  _type: BitVectorType;
  getLength(value: ArrayLike<boolean>): number {
    return this._type.length;
  }
  getByteLength(value: ArrayLike<boolean>): number {
    return Math.ceil(this._type.length / 8);
  }
  size(value: ArrayLike<boolean>): number {
    return Math.ceil(this._type.length / 8);
  }
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
  fromBytes(data: Uint8Array, start: number, end: number): ArrayLike<boolean> {
    if ((end - start) !== this.size(null)) {
      throw new Error("Invalid bitvector, length not equal to vector length");
    }
    const value = [];
    const toBool = (c: string): boolean => c === "1" ? true : false;
    for (let i = start; i < end-1; i++) {
      value.push(...Array.prototype.map.call(data[i].toString(2), toBool));
    }
    const lastByte = data[end-1];
    const lastIndex = (this._type.length-1) % 8;
    value.push(...Array.prototype.map.call(lastByte.toString(2), toBool).slice(0, lastIndex));
    return value as ArrayLike<boolean>;
  }
  serializeTo(value: ArrayLike<boolean>, output: Uint8Array, offset: number): number {
    const byteLength = this.getByteLength(value);
    for (let i = 0; i < byteLength; i++) {
      output[offset + i] = this.getByte(value, i);
    }
    return offset + byteLength;
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
