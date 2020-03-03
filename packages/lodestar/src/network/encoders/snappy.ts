import {IReqRespEncoder} from "./interface";
import {Type} from "@chainsafe/ssz";
import {compress, uncompress} from "snappyjs";

export class SnappyEncoder implements IReqRespEncoder {

  public decode(type: Type<unknown>, data: Buffer): Buffer {
    return uncompress(data);
  }

  public encode(type: Type<unknown>, data: Buffer): Buffer {
    return compress(data);
  }

}