import {Tree} from "@chainsafe/persistent-merkle-tree";

import {ByteVector} from "../../interface";
import {ByteVectorType} from "../../types";
import {BasicVectorTreeHandler} from "./vector";

export class ByteVectorTreeHandler extends BasicVectorTreeHandler<ByteVector> {
  _type: ByteVectorType;
  constructor(type: ByteVectorType) {
    super(type);
    this._type = type;
  }
  valueOf(target: Tree): Uint8Array {
    return this.serialize(target);
  }
}
