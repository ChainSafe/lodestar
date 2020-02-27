import {IReqRespEncoder} from "./interface";
import {ObjectLike, Type} from "@chainsafe/ssz";

export class SszEncoder implements IReqRespEncoder {

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public decode(type: Type<unknown>, data: unknown): ObjectLike {
    return type.deserialize(data as Uint8Array);
  }

  public encode<T>(type: Type<T>, data: T): Buffer {
    return Buffer.from(type.serialize(data));
  }

}