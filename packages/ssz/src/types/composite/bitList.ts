import {BitList} from "../../interface";
import {BasicListType} from "./list";
import {booleanType} from "../basic";
import {
  BitListStructuralHandler,
  BitListTreeHandler,
} from "../../backings";

export interface IBitListOptions {
  limit: number;
}

export class BitListType extends BasicListType<BitList> {
  constructor(options: IBitListOptions) {
    super({elementType: booleanType, ...options});
    this.structural = new BitListStructuralHandler(this);
    this.tree = new BitListTreeHandler(this);
  }
  chunkCount(): number {
    return Math.ceil(this.limit / 256);
  }
}
