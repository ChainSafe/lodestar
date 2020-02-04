import {ByteVector} from "../../interface";
import {BasicVectorType} from "./vector";
import {byteType} from "../basic";
import {
  ByteVectorStructuralHandler,
  ByteVectorTreeHandler
} from "../../backings";

export interface IByteVectorOptions {
  length: number;
}

export class ByteVectorType extends BasicVectorType<ByteVector> {
  constructor(options: IByteVectorOptions) {
    super({elementType: byteType, ...options});
    this.structural = new ByteVectorStructuralHandler(this);
    this.tree = new ByteVectorTreeHandler(this);
  }
}
