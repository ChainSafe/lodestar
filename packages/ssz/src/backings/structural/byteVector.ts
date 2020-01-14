import {ByteVectorType} from "../../types";
import {BasicVectorStructuralHandler} from "./vector";

export class ByteVectorStructuralHandler extends BasicVectorStructuralHandler<ArrayLike<number>> {
  _type: ByteVectorType;
  defaultValue(): ArrayLike<number> {
    return new Uint8Array(this._type.length);
  }
  serializeTo(value: ArrayLike<number>, output: Uint8Array, offset: number): number {
    output.set(value, offset);
    return offset + this._type.length;
  }
}
