/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import {
  AnySSZType,
  FullSSZType,
  parseType
} from "@chainsafe/ssz-type-schema";

import {_assertValidValue} from "../core/assertValidValue";

import {leafIndices} from "./leafIndices";
import {buildProof} from "./buildProof";

import {BasicProofBuilder} from "./util/basicProof";
import {BasicTree, GeneralizedIndex, BasicProof} from "./util/types";

/**
 * Return a full merkle tree
 */
export function basicTree(value: any, type: AnySSZType): BasicTree {
  const _type = parseType(type);
  _assertValidValue(value, _type);
  const indices = leafIndices(value, _type);
  return basicProof(value, _type, indices);
}

export function basicProof(value: any, type: FullSSZType, leafIndices: GeneralizedIndex[]): BasicProof {
  const rootIndex = 1n;
  const proofBuilder = new BasicProofBuilder({leaves: leafIndices});
  buildProof(proofBuilder, rootIndex, value, type);
  return proofBuilder.proof();
}
