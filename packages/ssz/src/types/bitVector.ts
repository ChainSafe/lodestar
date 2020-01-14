import {BitVectorStructuralHandler} from "../backings/structural";
import {BasicVectorType} from "./vector";
import {booleanType} from "./wellKnown";

export interface IBitVectorOptions {
  length: number;
}

export class BitVectorType extends BasicVectorType<ArrayLike<boolean>> {
  constructor(options: IBitVectorOptions) {
    super({elementType: booleanType, ...options});
    this.structural = new BitVectorStructuralHandler(this);
  }
  chunkCount(): number {
    return Math.ceil(this.length / 256);
  }
}
