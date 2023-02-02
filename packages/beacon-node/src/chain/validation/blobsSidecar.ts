import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {deneb, Root, ssz} from "@lodestar/types";
import {bytesToBigInt} from "@lodestar/utils";
import {BYTES_PER_FIELD_ELEMENT, FIELD_ELEMENTS_PER_BLOB} from "@lodestar/params";
import {verifyKzgCommitmentsAgainstTransactions} from "@lodestar/state-transition";
import {BlobsSidecarError, BlobsSidecarErrorCode} from "../errors/blobsSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {ckzg} from "../../util/kzg.js";

const BLS_MODULUS = BigInt("52435875175126190479447740508185965837690552500527637822603658699938581184513");

export function validateGossipBlobsSidecar(
  signedBlock: deneb.SignedBeaconBlock,
  blobsSidecar: deneb.BlobsSidecar
): void {
  const block = signedBlock.message;

  // Spec: https://github.com/ethereum/consensus-specs/blob/4cb6fd1c8c8f190d147d15b182c2510d0423ec61/specs/eip4844/p2p-interface.md#beacon_block_and_blobs_sidecar
  // [REJECT] The KZG commitments of the blobs are all correctly encoded compressed BLS G1 Points.
  // -- i.e. all(bls.KeyValidate(commitment) for commitment in block.body.blob_kzg_commitments)
  const {blobKzgCommitments} = block.body;
  for (let i = 0; i < blobKzgCommitments.length; i++) {
    if (!blsKeyValidate(blobKzgCommitments[i])) {
      throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_KZG, kzgIdx: i});
    }
  }

  // [REJECT] The KZG commitments correspond to the versioned hashes in the transactions list.
  // -- i.e. verify_kzg_commitments_against_transactions(block.body.execution_payload.transactions, block.body.blob_kzg_commitments)
  if (
    !verifyKzgCommitmentsAgainstTransactions(block.body.executionPayload.transactions, block.body.blobKzgCommitments)
  ) {
    throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_KZG_TXS});
  }

  // [IGNORE] the sidecar.beacon_block_slot is for the current slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // -- i.e. sidecar.beacon_block_slot == block.slot.
  if (blobsSidecar.beaconBlockSlot !== block.slot) {
    throw new BlobsSidecarError(GossipAction.IGNORE, {
      code: BlobsSidecarErrorCode.INCORRECT_SLOT,
      blobSlot: blobsSidecar.beaconBlockSlot,
      blockSlot: block.slot,
    });
  }

  // [REJECT] the sidecar.blobs are all well formatted, i.e. the BLSFieldElement in valid range (x < BLS_MODULUS).
  for (let i = 0; i < blobsSidecar.blobs.length; i++) {
    if (!blobIsValidRange(blobsSidecar.blobs[i])) {
      throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_BLOB, blobIdx: i});
    }
  }

  // [REJECT] The KZG proof is a correctly encoded compressed BLS G1 Point
  // -- i.e. blsKeyValidate(blobs_sidecar.kzg_aggregated_proof)
  if (!blsKeyValidate(blobsSidecar.kzgAggregatedProof)) {
    throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_KZG_PROOF});
  }

  // [REJECT] The KZG commitments in the block are valid against the provided blobs sidecar. -- i.e.
  // validate_blobs_sidecar(block.slot, hash_tree_root(block), block.body.blob_kzg_commitments, sidecar)
  validateBlobsSidecar(
    block.slot,
    ssz.bellatrix.BeaconBlock.hashTreeRoot(block),
    block.body.blobKzgCommitments,
    blobsSidecar
  );
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#validate_blobs_sidecar
export function validateBlobsSidecar(
  slot: number,
  beaconBlockRoot: Root,
  expectedKzgCommitments: deneb.KZGCommitment[],
  blobsSidecar: deneb.BlobsSidecar
): void {
  // assert slot == blobs_sidecar.beacon_block_slot
  if (slot != blobsSidecar.beaconBlockSlot) {
    throw new Error(`slot mismatch. Block slot: ${slot}, Blob slot ${blobsSidecar.beaconBlockSlot}`);
  }

  // assert beacon_block_root == blobs_sidecar.beacon_block_root
  if (!byteArrayEquals(beaconBlockRoot, blobsSidecar.beaconBlockRoot)) {
    throw new Error(
      `beacon block root mismatch. Block root: ${beaconBlockRoot}, Blob root ${blobsSidecar.beaconBlockRoot}`
    );
  }

  // blobs = blobs_sidecar.blobs
  // kzg_aggregated_proof = blobs_sidecar.kzg_aggregated_proof
  const {blobs, kzgAggregatedProof} = blobsSidecar;

  // assert len(expected_kzg_commitments) == len(blobs)
  if (expectedKzgCommitments.length !== blobs.length) {
    throw new Error(
      `blobs length to commitments length mismatch. Blob length: ${blobs.length}, Expected commitments length ${expectedKzgCommitments.length}`
    );
  }

  // No need to verify the aggregate proof of zero blobs. Also c-kzg throws.
  // https://github.com/dankrad/c-kzg/pull/12/files#r1025851956
  if (blobs.length > 0) {
    // assert verify_aggregate_kzg_proof(blobs, expected_kzg_commitments, kzg_aggregated_proof)
    let isProofValid: boolean;
    try {
      isProofValid = ckzg.verifyAggregateKzgProof(blobs, expectedKzgCommitments, kzgAggregatedProof);
    } catch (e) {
      // TODO DENEB: TEMP Nov17: May always throw error -- we need to fix Geth's KZG to match C-KZG and the trusted setup used here
      (e as Error).message = `Error on verifyAggregateKzgProof: ${(e as Error).message}`;
      throw e;
    }

    // TODO DENEB: TEMP Nov17: May always throw error -- we need to fix Geth's KZG to match C-KZG and the trusted setup used here
    if (!isProofValid) {
      throw Error("Invalid AggregateKzgProof");
    }
  }
}

/**
 * From https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-bls-signature-04#section-2.5
 * KeyValidate = valid, non-identity point that is in the correct subgroup
 */
function blsKeyValidate(g1Point: Uint8Array): boolean {
  try {
    bls.PublicKey.fromBytes(g1Point, CoordType.jacobian, true);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * ```
 * Blob = new ByteVectorType(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB);
 * ```
 * Check that each FIELD_ELEMENT as a uint256 < BLS_MODULUS
 */
function blobIsValidRange(blob: deneb.Blob): boolean {
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB; i++) {
    const fieldElement = blob.subarray(i * BYTES_PER_FIELD_ELEMENT, (i + 1) * BYTES_PER_FIELD_ELEMENT);
    const fieldElementBN = bytesToBigInt(fieldElement, "be");
    if (fieldElementBN >= BLS_MODULUS) {
      return false;
    }
  }

  return true;
}
