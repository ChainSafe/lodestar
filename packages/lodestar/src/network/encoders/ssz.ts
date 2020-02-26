import {IReqRespEncoder} from "./interface";
import {BasicType, ContainerType, ObjectLike} from "@chainsafe/ssz";

export class SszEncoder implements IReqRespEncoder {

  public decode(type: ContainerType<unknown>|BasicType<unknown>, data: unknown): ObjectLike {
    return type.deserialize(data as Uint8Array);
  }

  public encode<T>(type: ContainerType<T>|BasicType<T>, data: T): Buffer {
    return Buffer.from(type.serialize(data));
  }

}