import {Type, UintType, BoolType} from "@chainsafe/ssz-type-schema";

export const bit: BoolType = {
  type: Type.bool,
};

export const byte: UintType = {
  type: Type.uint,
  byteLength: 1,
  use: "number",
};
