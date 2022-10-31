// Constants
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/polynomial-commitments.md#constants

import {KZGCommitment} from "@lodestar/types/eip4844";
import {bitReversalPermutation} from "./bitReversalPermutation.js";

// Scalar field modulus of BLS12-381
export const BLS_MODULUS = BigInt("52435875175126190479447740508185965837690552500527637822603658699938581184513");

// Roots of unity of order FIELD_ELEMENTS_PER_BLOB over the BLS12-381 field
export const ROOTS_OF_UNITY: KZGCommitment[] = [];
export const KZG_SETUP_LAGRANGE = bitReversalPermutation(ROOTS_OF_UNITY);
