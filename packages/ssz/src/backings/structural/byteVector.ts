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
  serializeTo(value: Vector<number>, output: Uint8Array, offset: number): number {
    output.set(value, offset);
    return offset + this._type.length;
  }
}
