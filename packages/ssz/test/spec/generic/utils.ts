/* eslint-disable camelcase,@typescript-eslint/no-object-literal-type-assertion */
import {Hash, uint256} from "@chainsafe/eth2.0-types";
import {bytes} from "@chainsafe/eth2.0-types/lib";
import BN from "bn.js";
import {BoolType, FullSSZType, Type, UintType} from "@chainsafe/ssz-type-schema";

export interface IValidGenericSSZTestCase {
  meta: {
    root: string;
    signingRoot?: string;
  };
  serialized_raw: bytes;
  value: any;
}

export interface IInValidGenericSSZTestCase {
  serialized_raw: bytes;
}

export interface IValidTestResult {
  root: Hash;
  signingRoot?: Hash;
  encoded: bytes;
  decoded: any;
}

export function parseBitVectorType(name: string): {type: FullSSZType; length: uint256} {
  const parts = name.split("_");
  return {
    type: typeToEnum(parts[1]),
    length: new BN(parts[2]),
  };
}

function typeToEnum(type: string): FullSSZType {
  switch (type) {
    case "bool": return {type: Type.bool} as BoolType;
    case "uint8": return {type: Type.uint, useNumber: true, byteLength: 1} as UintType;
    case "uint16": return {type: Type.uint, useNumber: true, byteLength: 2} as UintType;
    case "uint32": return {type: Type.uint, useNumber: true, byteLength: 4} as UintType;
    case "uint64": return {type: Type.uint, useNumber: false, byteLength: 8} as UintType;
    case "uint128": return {type: Type.uint, useNumber: false, byteLength: 16} as UintType;
    case "uint256": return {type: Type.uint, useNumber: false, byteLength: 32} as UintType;
    default: throw Error(`Missing type ${type}`);
  }
}