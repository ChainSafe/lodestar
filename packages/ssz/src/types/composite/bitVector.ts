import {BitVector} from "../../interface";
import {BasicVectorType} from "./vector";
import {booleanType} from "../basic";
import {
  BitVectorStructuralHandler,
  BitVectorTreeHandler,
} from "../../backings";

export interface IBitVectorOptions {
  length: number;
}

export class BitVectorType extends BasicVectorType<BitVector> {
  constructor(options: IBitVectorOptions) {
    super({elementType: booleanType, ...options});
    this.structural = new BitVectorStructuralHandler(this);
    this.tree = new BitVectorTreeHandler(this);
  }
  chunkCount(): number {
    return Math.ceil(this.length / 256);
  }
}
