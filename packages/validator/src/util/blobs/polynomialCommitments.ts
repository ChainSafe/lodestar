import {IChainForkConfig} from "@lodestar/config";
import {blindedOrFullBlockHashTreeRoot} from "@lodestar/state-transition";
import {allForks, ssz} from "@lodestar/types";
import {
  Blob,
  Blobs,
  BlobsSidecar,
  KZGCommitment,
  KZGProof,
  PolynomialAndCommitment,
  Polynomial,
  BLSFieldElement,
} from "@lodestar/types/eip4844";
import {digest} from "@chainsafe/as-sha256";
import {KZG_SETUP_LAGRANGE} from "./constants.js";
import {bytesToBLSField, g1Lincomb} from "./bls.js";

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#hash_to_bls_field
// def hash_to_bls_field(x: Container) -> BLSFieldElement:
//     """
//     Compute 32-byte hash of serialized container and convert it to BLS field.
//     The output is not uniform over the BLS field.
//     """
//     return bytes_to_bls_field(hash(ssz_serialize(x)))
export function hashToBlsField(x: PolynomialAndCommitment): BLSFieldElement {
  return bytesToBLSField(digest(ssz.eip4844.PolynomialAndCommitment.serialize(x)));
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/polynomial-commitments.md#blob_to_kzg_commitment
// def blob_to_kzg_commitment(blob: Blob) -> KZGCommitment:
//     return g1_lincomb(bit_reversal_permutation(KZG_SETUP_LAGRANGE), blob)
export function blobToKzgCommitment(blob: Blob): KZGCommitment {
  return g1Lincomb(KZG_SETUP_LAGRANGE, blob);
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/polynomial-commitments.md#evaluate_polynomial_in_evaluation_form
// def evaluate_polynomial_in_evaluation_form(polynomial: Sequence[BLSFieldElement],
//                                            z: BLSFieldElement) -> BLSFieldElement:
//     """
//     Evaluate a polynomial (in evaluation form) at an arbitrary point `z`
//     Uses the barycentric formula:
//        f(z) = (1 - z**WIDTH) / WIDTH  *  sum_(i=0)^WIDTH  (f(DOMAIN[i]) * DOMAIN[i]) / (z - DOMAIN[i])
//     """
//     width = len(polynomial)
//     assert width == FIELD_ELEMENTS_PER_BLOB
//     inverse_width = bls_modular_inverse(width)

//     # Make sure we won't divide by zero during division
//     assert z not in ROOTS_OF_UNITY

//     roots_of_unity_brp = bit_reversal_permutation(ROOTS_OF_UNITY)

//     result = 0
//     for i in range(width):
//         result += div(int(polynomial[i]) * int(roots_of_unity_brp[i]), (z - roots_of_unity_brp[i]))
//     result = result * (pow(z, width, BLS_MODULUS) - 1) * inverse_width % BLS_MODULUS
//     return result
export function evaluatePolynomialInEvaluationForm(_polynomial: Polynomial, _z: BLSFieldElement): BLSFieldElement {
  // This is now in https://pkg.go.dev/github.com/protolambda/go-kzg@v0.0.0-20221025081131-f3a74d3b1d0c/bls?utm_source=gopls#EvaluatePolyInEvaluationForm
  // We will use a KZG library for this!
  return ssz.eip4844.BLSFieldElement.defaultValue();
}

// https://github.com/ethereum/consensus-specs/blob/3552e2f6e8cb62f6342733d135c9fe8eecd26ecf/specs/eip4844/polynomial-commitments.md#compute_kzg_proof
// def compute_kzg_proof(polynomial: Sequence[BLSFieldElement], z: BLSFieldElement) -> KZGProof:
//     """
//     Compute KZG proof at point `z` with `polynomial` being in evaluation form
//     """

//     # To avoid SSZ overflow/underflow, convert element into int
//     polynomial = [int(i) for i in polynomial]
//     z = int(z)

//     # Shift our polynomial first (in evaluation form we can't handle the division remainder)
//     y = evaluate_polynomial_in_evaluation_form(polynomial, z)
//     polynomial_shifted = [(p - int(y)) % BLS_MODULUS for p in polynomial]

//     # Make sure we won't divide by zero during division
//     assert z not in ROOTS_OF_UNITY
//     denominator_poly = [(x - z) % BLS_MODULUS for x in bit_reversal_permutation(ROOTS_OF_UNITY)]

//     # Calculate quotient polynomial by doing point-by-point division
//     quotient_polynomial = [div(a, b) for a, b in zip(polynomial_shifted, denominator_poly)]
//     return KZGProof(g1_lincomb(bit_reversal_permutation(KZG_SETUP_LAGRANGE), quotient_polynomial))
export function computeKzgProof(polynomial: Polynomial, z: BLSFieldElement): KZGProof {
  // const polynomialNumeric = polynomial.map(bytesToNumber);
  // const zed = bytesToNumber(z);

  // Shift our polynomial first (in evaluation form we can't handle the division remainder)
  const _y = evaluatePolynomialInEvaluationForm(polynomial, z);
  // const polynomialShifted = polynomialNumeric.map((p) => (((p) - y) % BLS_MODULUS);

  return ssz.eip4844.KZGProof.defaultValue();
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#compute_aggregated_poly_and_commitment
export function computeAggregatedPolynomialAndCommitment(
  _blobs: Blobs,
  _commitments: KZGCommitment[]
): PolynomialAndCommitment {
  const polynomialAndCommitment = ssz.eip4844.PolynomialAndCommitment.defaultValue();
  polynomialAndCommitment.polynomial = ssz.eip4844.Polynomial.defaultValue();
  polynomialAndCommitment.kzgCommitment = ssz.eip4844.KZGCommitment.defaultValue();

  return polynomialAndCommitment;
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#compute_proof_from_blobs
// def compute_proof_from_blobs(blobs: Sequence[Blob]) -> KZGProof:
//     commitments = [blob_to_kzg_commitment(blob) for blob in blobs]
//     aggregated_poly, aggregated_poly_commitment = compute_aggregated_poly_and_commitment(blobs, commitments)
//     x = hash_to_bls_field(PolynomialAndCommitment(
//         polynomial=aggregated_poly,
//         kzg_commitment=aggregated_poly_commitment,
//     ))
//     return compute_kzg_proof(aggregated_poly, x)
export function computeProofFromBlobs(blobs: Blobs): KZGProof {
  const commitments = blobs.map(blobToKzgCommitment);
  const aggregatedPolyAndCommitment = computeAggregatedPolynomialAndCommitment(blobs, commitments);
  const x = hashToBlsField(aggregatedPolyAndCommitment);
  return computeKzgProof(aggregatedPolyAndCommitment.polynomial, x);
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#sidecar
// def get_blobs_sidecar(block: BeaconBlock, blobs: Sequence[Blob]) -> BlobsSidecar:
//   return BlobsSidecar(
//       beacon_block_root=hash_tree_root(block),
//       beacon_block_slot=block.slot,
//       blobs=blobs,
//       kzg_aggregated_proof=compute_proof_from_blobs(blobs),
//   )
export function getBlobsSidecar(
  config: IChainForkConfig,
  block: allForks.FullOrBlindedBeaconBlock,
  blobs: Blobs
): BlobsSidecar {
  const blobsSidecar = ssz.eip4844.BlobsSidecar.defaultValue();

  blobsSidecar.beaconBlockRoot = blindedOrFullBlockHashTreeRoot(config, block);
  blobsSidecar.beaconBlockSlot = block.slot;
  blobsSidecar.blobs = blobs;
  blobsSidecar.kzgAggregatedProof = computeProofFromBlobs(blobs);

  return blobsSidecar;
}
