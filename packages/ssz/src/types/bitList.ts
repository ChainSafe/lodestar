import {BitListStructuralHandler} from "../backings/structural";
import {BasicListType} from "./list";
import {booleanType} from "./wellKnown";

export interface IBitListOptions {
  limit: number;
}

export class BitListType extends BasicListType<ArrayLike<boolean>> {
  constructor(options: IBitListOptions) {
    super({elementType: booleanType, ...options});
    this.structural = new BitListStructuralHandler(this);
  }
  chunkCount(): number {
    return Math.ceil(this.limit / 256);
  }
}
