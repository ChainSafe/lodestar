import {IReqRespEncoder} from "./interface";
import {BasicType, ContainerType} from "@chainsafe/ssz";
import {compress, uncompress} from "snappyjs";

export class SnappyEncoder implements IReqRespEncoder {

  public decode(type: ContainerType<unknown>|BasicType<unknown>, data: Buffer): Buffer {
    return uncompress(data);
  }

  public encode(type: ContainerType<unknown>|BasicType<unknown>, data: Buffer): Buffer {
    return compress(data);
  }

}