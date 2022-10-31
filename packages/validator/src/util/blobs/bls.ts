// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/polynomial-commitments.md#bls12-381-helpers

import {KZGCommitment, BLSFieldElement} from "@lodestar/types/eip4844";
import * as ssz from "@lodestar/types/eip4844/sszTypes";
import {Bytes32} from "@lodestar/types";
import {bytesToBigInt, intToBytes, bigIntToBytes} from "@lodestar/utils";
import {BLS_MODULUS} from "./constants.js";

// def bytes_to_bls_field(b: Bytes32) -> BLSFieldElement:
//     """
//     Convert bytes to a BLS field scalar. The output is not uniform over the BLS field.
//     """
//     return int.from_bytes(b, "little") % BLS_MODULUS
export function bytesToBLSField(b: Bytes32): BLSFieldElement {
  return intToBytes(bytesToBigInt(b) % BLS_MODULUS, 32);
}

// def bls_modular_inverse(x: BLSFieldElement) -> BLSFieldElement:
//     """
//     Compute the modular inverse of x
//     i.e. return y such that x * y % BLS_MODULUS == 1 and return 0 for x == 0
//     """
//     return pow(x, -1, BLS_MODULUS) if x != 0 else 0
export function blsModularInverse(x: BLSFieldElement): BLSFieldElement {
  // Maybe BLSFieldElement should actually just be "number"?
  const value = bytesToBigInt(x);
  if (value !== BigInt(0)) {
    return intToBytes(value ** BigInt(-1) % BLS_MODULUS, 32);
  }
  return intToBytes(0, 32);
}

// def div(x: BLSFieldElement, y: BLSFieldElement) -> BLSFieldElement:
//     """Divide two field elements: `x` by `y`"""
//     return (int(x) * int(bls_modular_inverse(y))) % BLS_MODULUS
export function div(x: BLSFieldElement, y: BLSFieldElement): BLSFieldElement {
  const product = bytesToBigInt(x) * bytesToBigInt(blsModularInverse(y));
  return bigIntToBytes(product % BLS_MODULUS, 32);
}

// def g1_lincomb(points: Sequence[KZGCommitment], scalars: Sequence[BLSFieldElement]) -> KZGCommitment:
//     """
//     BLS multiscalar multiplication. This function can be optimized using Pippenger's algorithm and variants.
//     """
//     assert len(points) == len(scalars)
//     result = bls.Z1
//     for x, a in zip(points, scalars):
//         result = bls.add(result, bls.multiply(bls.bytes48_to_G1(x), a))
//     return KZGCommitment(bls.G1_to_bytes48(result))
export function g1Lincomb(points: KZGCommitment[], scalars: BLSFieldElement[]): KZGCommitment {
  if (points.length !== scalars.length) {
    throw new Error("BLS multiscalar multiplication requires points length to match scalars length.");
  }

  return ssz.KZGCommitment.defaultValue();
}

// def vector_lincomb(vectors: Sequence[Sequence[BLSFieldElement]],
//                    scalars: Sequence[BLSFieldElement]) -> Sequence[BLSFieldElement]:
//     """
//     Given a list of ``vectors``, interpret it as a 2D matrix and compute the linear combination
//     of each column with `scalars`: return the resulting vector.
//     """
//     result = [0] * len(vectors[0])
//     for v, s in zip(vectors, scalars):
//         for i, x in enumerate(v):
//             result[i] = (result[i] + int(s) * int(x)) % BLS_MODULUS
//     return [BLSFieldElement(x) for x in result]
export function vectorLincomb(_vectors: BLSFieldElement[][], _scalars: BLSFieldElement[]): BLSFieldElement[] {
  return [];
}
