import {Vector} from "../../interface";
import {ByteVectorType} from "../../types";
import {BasicVectorStructuralHandler} from "./vector";

export class ByteVectorStructuralHandler extends BasicVectorStructuralHandler<Vector<number>> {
  _type: ByteVectorType;
  constructor(type: ByteVectorType) {
    super(type);
    this._type = type;
  }
  defaultValue(): Vector<number> {
    return new Uint8Array(this._type.length);
  }
  fromBytes(data: Uint8Array, start: number, end: number): Vector<number> {
    const length = end - start;
    if (length !== this._type.length) {
      throw new Error(`Invalid deserialized vector length: expected ${this._type.length}, actual: ${length}`);
    }
    const value = new Uint8Array(length);
    value.set(data.slice(start, end));
    return value;
  }
  toBytes(value: Vector<number>, output: Uint8Array, offset: number): number {
    output.set(value, offset);
    return offset + this._type.length;
  }
}
