import {Vector} from "../interface";
import {BasicVectorType} from "./vector";
import {byteType} from "./wellKnown";
import {ByteVectorStructuralHandler} from "../backings/structural";

export interface IByteVectorOptions {
  length: number;
}

export class ByteVectorType extends BasicVectorType<Vector<number>> {
  constructor(options: IByteVectorOptions) {
    super({elementType: byteType, ...options});
    this.structural = new ByteVectorStructuralHandler(this);
  }
}
