/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import {FullSSZType} from "@chainsafe/ssz-type-schema";

import {_assertValidValue} from "../core/assertValidValue";
import {buildProof} from "./buildProof";

import {GeneralizedIndex, ClassicProof} from "./util/types";
import {ClassicProofBuilder} from "./util/classicProof";

export function classicProof(value: any, type: FullSSZType, leafIndices: GeneralizedIndex[]): ClassicProof {
  const rootIndex = 1n;
  const proofBuilder = new ClassicProofBuilder({leaves: leafIndices});
  buildProof(proofBuilder, rootIndex, value, type);
  return proofBuilder.proof();
}
