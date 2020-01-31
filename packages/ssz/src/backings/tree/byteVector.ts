import {TreeBacking} from "@chainsafe/merkle-tree";

import {Vector} from "../../interface";
import {ByteVectorType} from "../../types";
import {BasicVectorTreeHandler} from "./vector";

export class ByteVectorTreeHandler extends BasicVectorTreeHandler<Vector<number>> {
  _type: ByteVectorType;
  constructor(type: ByteVectorType) {
    super(type);
    this._type = type;
  }
  valueOf(target: TreeBacking, x: any): Uint8Array {
    return this.serialize(target);
  }
}
