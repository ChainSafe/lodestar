import {BasicType, ContainerType} from "@chainsafe/ssz";

export interface IReqRespEncoder {
  encode(type: ContainerType<unknown>|BasicType<unknown>, data: unknown): unknown;
  decode(type: ContainerType<unknown>|BasicType<unknown>, data: unknown): unknown;
}