/* eslint-disable @typescript-eslint/interface-name-prefix,@typescript-eslint/no-object-literal-type-assertion */
import {bytes256, uint16, uint32, uint64, uint8} from "@chainsafe/eth2.0-types";
import {
  AnyContainerType,
  BitListType,
  BitVectorType,
  ListType,
  Type,
  UintType,
  VectorType
} from "@chainsafe/ssz-type-schema";
import {BitList, BitVector} from "@chainsafe/bit-utils";

export interface SingleFieldTestStruct {
  a: uint8;
}

export const SingleFieldTestStruct: AnyContainerType = {
  fields: [
    ["a", "uint8"]
  ]
};

export interface SmallTestStruct {
  a: uint16;
  b: uint16;
}

export const SmallTestStruct: AnyContainerType = {
  fields: [
    ["a", "uint16"],
    ["b", "uint16"],
  ]
};

export interface FixedTestStruct {
  a: uint8;
  b: uint64;
  c: uint32;
}

export const FixedTestStruct: AnyContainerType = {
  fields: [
    ["a", "uint8"],
    ["b", "uint64"],
    ["c", "uint32"],
  ]
};

export interface VarTestStruct {
  a: uint16;
  b: uint16[];
  c: uint8;
}

export const VarTestStruct: AnyContainerType = {
  fields: [
    ["a", "uint16"],
    [
      "b",
      {
        type: Type.list,
        elementType: {
          type: Type.uint,
          byteLength: 2,
          useNumber: true
        } as UintType,
        maxLength: 1024
      } as ListType],
    ["c", "uint32"],
  ]
};

export interface ComplexTestStruct {
  a: uint16;
  b: uint16[];
  c: uint8;
  d: bytes256;
  e: VarTestStruct;
  f: FixedTestStruct[];
  g: VarTestStruct[];
}

export const ComplexTestStruct: AnyContainerType = {
  fields: [
    ["a", "uint16"],
    [
      "b",
      {
        type: Type.list,
        elementType: {
          type: Type.uint,
          byteLength: 2,
          useNumber: true
        } as UintType,
        maxLength: 128
      } as ListType],
    ["c", "uint8"],
    ["d", "bytes256"],
    ["e", VarTestStruct],
    ["f", {
      type: Type.vector,
      elementType: FixedTestStruct,
      length: 4
    } as VectorType],
    ["g", {
      type: Type.vector,
      elementType: VarTestStruct,
      length: 2
    } as VectorType]
  ]
};

export interface BitsStruct {
  a: BitList;
  b: BitVector;
  c: BitVector;
  d: BitList;
  e: BitVector;
}

export const BitsStruct: AnyContainerType = {
  fields: [
    ["a", {type:Type.bitList, maxLength: 5} as BitListType],
    ["b", {type:Type.bitVector, length: 2} as BitVectorType],
    ["c", {type:Type.bitVector, length: 1} as BitVectorType],
    ["d", {type:Type.bitList, maxLength: 6} as BitListType],
    ["e", {type:Type.bitVector, length: 8} as BitVectorType],
  ]
};
