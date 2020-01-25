import {BitList} from "../../interface";
import {BasicListType} from "./list";
import {booleanType} from "../basic";
import {BitListStructuralHandler} from "../../backings/structural";

export interface IBitListOptions {
  limit: number;
}

export class BitListType extends BasicListType<BitList> {
  constructor(options: IBitListOptions) {
    super({elementType: booleanType, ...options});
    this.structural = new BitListStructuralHandler(this);
  }
  chunkCount(): number {
    return Math.ceil(this.limit / 256);
  }
}
