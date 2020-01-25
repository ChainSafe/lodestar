import {BitVector} from "../../interface";
import {BitVectorType} from "../../types";
import {BasicVectorStructuralHandler} from "./vector";

export class BitVectorStructuralHandler extends BasicVectorStructuralHandler<BitVector> {
  _type: BitVectorType;
  constructor(type: BitVectorType) {
    super(type);
    this._type = type;
  }
  getLength(value: BitVector): number {
    return this._type.length;
  }
  getByteLength(value: BitVector): number {
    return Math.ceil(this._type.length / 8);
  }
  size(value: BitVector): number {
    return Math.ceil(this._type.length / 8);
  }
  getByte(value: BitVector, index: number): number {
    const firstBitIndex = index * 8;
    const lastBitIndex = Math.min(firstBitIndex + 7, value.length - 1);
    let bitstring = "0b";
    for (let i = lastBitIndex; i >= firstBitIndex; i--) {
      bitstring += value[i] ? "1" : "0";
    }
    return Number(bitstring);
  }
  fromBytes(data: Uint8Array, start: number, end: number): BitVector {
    if ((end - start) !== this.size(null)) {
      throw new Error("Invalid bitvector, length not equal to vector length");
    }
    const value = [];
    const toBool = (c: string): boolean => c === "1" ? true : false;
    for (let i = start; i < end-1; i++) {
      value.push(...Array.prototype.map.call(data[i].toString(2), toBool).reverse());
    }
    const lastByte = data[end-1];
    const lastIndex = (this._type.length-1) % 8;
    value.push(...Array.prototype.map.call(lastByte.toString(2), toBool).reverse().slice(0, lastIndex + 1));
    return value as BitVector;
  }
  toBytes(value: BitVector, output: Uint8Array, offset: number): number {
    const byteLength = this.getByteLength(value);
    for (let i = 0; i < byteLength; i++) {
      output[offset + i] = this.getByte(value, i);
    }
    return offset + byteLength;
  }
  chunk(value: BitVector, index: number): Uint8Array {
    const output = new Uint8Array(32);
    const byteLength = Math.min(32, this.getByteLength(value) - index);
    for (let i = 0; i < byteLength; i++) {
      output[i] = this.getByte(value, i + index);
    }
    return output;
  }
}
