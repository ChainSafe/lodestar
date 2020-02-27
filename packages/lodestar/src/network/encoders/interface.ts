import {Type} from "@chainsafe/ssz";

export interface IReqRespEncoder<T = Type<unknown>> {
  encode(type: T, data: unknown): unknown;
  decode(type: T, data: unknown): unknown;
}