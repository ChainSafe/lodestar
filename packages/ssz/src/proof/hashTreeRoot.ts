/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import {AnySSZType, parseType} from "@chainsafe/ssz-type-schema";

import {_assertValidValue} from "../core/assertValidValue";
import {buildProof} from "./buildProof";

import {nullProofBuilder} from "./util/nullProof";

export function hashTreeRoot(value: any, type: AnySSZType): Buffer {
  const _type = parseType(type);
  _assertValidValue(value, _type);
  return buildProof(nullProofBuilder, 0n, value, _type);
}
